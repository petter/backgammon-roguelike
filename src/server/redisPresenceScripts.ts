/**
 * Atomic Lua scripts for per-seat presence leases and abandonment claims in Redis.
 * All timestamps come from Redis's own `TIME` in production so clock skew between server
 * instances cannot alter lease expiry or the 30-second claim grace.
 */
const PRESENCE_HELPERS = `
local function store_now(override)
  if override ~= '' then
    return tonumber(override)
  end
  local t = redis.call('TIME')
  return tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end

local function empty_presence()
  return {
    revision = 0,
    white = { connections = {}, disconnectedAt = cjson.null },
    black = { connections = {}, disconnectedAt = cjson.null },
  }
end

local function is_null(value)
  return value == nil or value == cjson.null
end

local function normalize_presence(p)
  if type(p.revision) ~= 'number' then p.revision = 0 end
  if type(p.white) ~= 'table' then p.white = { connections = {}, disconnectedAt = cjson.null } end
  if type(p.black) ~= 'table' then p.black = { connections = {}, disconnectedAt = cjson.null } end
  return p
end

local function clean_seat(seat, now)
  local live = {}
  local count = 0
  local latest_expired = nil
  if type(seat.connections) == 'table' then
    for id, exp in pairs(seat.connections) do
      if type(id) == 'string' and type(exp) == 'number' then
        if exp > now then
          live[id] = exp
          count = count + 1
        elseif latest_expired == nil or exp > latest_expired then
          latest_expired = exp
        end
      end
    end
  end
  seat.connections = live
  local expired = latest_expired ~= nil
  if count > 0 then
    seat.disconnectedAt = cjson.null
  elseif expired and is_null(seat.disconnectedAt) then
    seat.disconnectedAt = latest_expired
  end
  return count, expired
end
`;

export const CONNECT_SEAT = `${PRESENCE_HELPERS}
local now = store_now(ARGV[5])
local text = redis.call('GET', KEYS[1])
local p = text and normalize_presence(cjson.decode(text)) or empty_presence()
local seat = ARGV[1]
local conn = ARGV[2]
local lease_ms = tonumber(ARGV[3])
local white_live = clean_seat(p.white, now)
local black_live = clean_seat(p.black, now)
local was_online = (seat == 'white' and white_live or black_live) > 0
p[seat].connections[conn] = now + lease_ms
p[seat].disconnectedAt = cjson.null
p.revision = p.revision + 1
local encoded = cjson.encode(p)
redis.call('SET', KEYS[1], encoded, 'EX', ARGV[4])
return { encoded, was_online and 0 or 1, now }
`;

export const RENEW_SEAT = `${PRESENCE_HELPERS}
local now = store_now(ARGV[5])
local text = redis.call('GET', KEYS[1])
if not text then return false end
local p = normalize_presence(cjson.decode(text))
local seat = ARGV[1]
local conn = ARGV[2]
local lease_ms = tonumber(ARGV[3])
local _, white_exp = clean_seat(p.white, now)
local _, black_exp = clean_seat(p.black, now)
local active = p[seat].connections[conn] ~= nil
local dirty = white_exp or black_exp
if active then
  p[seat].connections[conn] = now + lease_ms
  p[seat].disconnectedAt = cjson.null
end
if dirty then
  p.revision = p.revision + 1
end
local encoded = cjson.encode(p)
if active or dirty then
  redis.call('SET', KEYS[1], encoded, 'EX', ARGV[4])
end
return { encoded, active and 1 or 0, now }
`;

export const DISCONNECT_SEAT = `${PRESENCE_HELPERS}
local now = store_now(ARGV[4])
local text = redis.call('GET', KEYS[1])
if not text then return false end
local p = normalize_presence(cjson.decode(text))
local seat = ARGV[1]
local conn = ARGV[2]
local was_disconnected = not is_null(p[seat].disconnectedAt)
local white_live, white_exp = clean_seat(p.white, now)
local black_live, black_exp = clean_seat(p.black, now)
local was_live = seat == 'white' and white_live or black_live
local had_conn = p[seat].connections[conn] ~= nil
local remaining = was_live
if had_conn then
  p[seat].connections[conn] = nil
  remaining = was_live - 1
  if remaining == 0 then
    p[seat].disconnectedAt = now
  end
end
if had_conn or white_exp or black_exp then
  p.revision = p.revision + 1
end
local encoded = cjson.encode(p)
if had_conn or white_exp or black_exp then
  redis.call('SET', KEYS[1], encoded, 'EX', ARGV[3])
end
local is_disconnected = remaining == 0 and not is_null(p[seat].disconnectedAt)
return { encoded, (not was_disconnected and is_disconnected) and 1 or 0, now }
`;

export const GET_PRESENCE = `${PRESENCE_HELPERS}
local now = store_now(ARGV[2])
local text = redis.call('GET', KEYS[1])
if not text then
  return { cjson.encode(empty_presence()), now }
end
local p = normalize_presence(cjson.decode(text))
local _, white_exp = clean_seat(p.white, now)
local _, black_exp = clean_seat(p.black, now)
if white_exp or black_exp then
  p.revision = p.revision + 1
  local encoded = cjson.encode(p)
  redis.call('SET', KEYS[1], encoded, 'EX', ARGV[1])
  return { encoded, now }
end
return { cjson.encode(p), now }
`;

/** Atomically checks room version and opponent absence, then commits the abandonment win. */
export const CLAIM_SEAT = `${PRESENCE_HELPERS}
local now = store_now(ARGV[8])
local current = redis.call('GET', KEYS[1])
if not current then return { 'conflict', now } end
local stored = cjson.decode(current)
if stored.id ~= ARGV[1] or stored.version ~= tonumber(ARGV[2]) then
  return { 'conflict', now }
end

local ptext = redis.call('GET', KEYS[2])
local p = ptext and normalize_presence(cjson.decode(ptext)) or empty_presence()
local _, white_exp = clean_seat(p.white, now)
local _, black_exp = clean_seat(p.black, now)
if white_exp or black_exp then
  p.revision = p.revision + 1
  redis.call('SET', KEYS[2], cjson.encode(p), 'EX', ARGV[7])
end
local p_encoded = cjson.encode(p)

local function match_index(game)
  if type(game) ~= 'table' then return nil end
  local total = 0
  if type(game.wins) == 'table' then
    total = (tonumber(game.wins.white) or 0) + (tonumber(game.wins.black) or 0)
  elseif not is_null(game.winner) then
    total = 1
  end
  if game.phase == 'over' then
    return total > 0 and (total - 1) or 0
  end
  return total
end

local game_started = is_null(stored.gameStartedAt) and nil or tonumber(stored.gameStartedAt)
local started_match = is_null(stored.gameStartedMatch) and nil or tonumber(stored.gameStartedMatch)
local current_match = match_index(stored.game)
local seat_info = type(stored.seats) == 'table' and stored.seats[ARGV[4]] or nil
if
  game_started == nil
  or started_match == nil
  or current_match == nil
  or started_match ~= current_match
  or type(seat_info) ~= 'table'
  or seat_info.presence ~= true
then
  return { 'online', now, p_encoded }
end

local opp = p[ARGV[4]]
local opp_live = 0
for _ in pairs(opp.connections) do opp_live = opp_live + 1 end
if opp_live > 0 then
  return { 'online', now, p_encoded }
end

local away_since = nil
local raw = is_null(opp.disconnectedAt) and nil or tonumber(opp.disconnectedAt)
local arrival_grace = tonumber(ARGV[6])
if raw ~= nil then
  away_since = raw < game_started and game_started or raw
else
  local ready_at = game_started + arrival_grace
  if now >= ready_at then
    away_since = ready_at
  end
end

if away_since == nil then
  return { 'online', now, p_encoded }
end

local claim_grace = tonumber(ARGV[5])
local remaining = claim_grace - (now - away_since)
if remaining > 0 then
  return { 'too_early', now, p_encoded, remaining }
end

redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[7])
return { 'ok', now, p_encoded }
`;
