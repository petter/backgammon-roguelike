import { afterEach, describe, expect, it, vi } from "vitest";

/** Just enough of an AudioContext for the engine to build its buses. */
class FakeContext {
  state: AudioContextState = "suspended";
  readonly currentTime = 0;
  readonly sampleRate = 8000;
  readonly destination = {};
  /** A browser starts the context some time after the press that allowed it. */
  resume = vi.fn<() => Promise<void>>(() => new Promise<void>(() => {}));
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createGain() {
    return { gain: { value: 1 }, connect: (node: unknown) => node };
  }
  createConvolver() {
    return { buffer: null, connect: (node: unknown) => node };
  }
  createDynamicsCompressor() {
    const param = { value: 0 };
    return {
      threshold: param,
      knee: param,
      ratio: param,
      attack: param,
      release: param,
      connect: (node: unknown) => node,
    };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("audio engine", () => {
  it("plays sounds asked for while the first press is still starting the context", async () => {
    vi.stubGlobal("window", { AudioContext: FakeContext });
    const { unlockAudio, voice } = await import("../src/audio/engine.ts");
    const target = new EventTarget();
    unlockAudio(target);
    expect(voice()).toBeNull();
    // The press that starts a hot-seat game also starts the context, and the game's first
    // sound is asked for before the context reports that it is running.
    target.dispatchEvent(new Event("pointerdown"));
    expect(voice()).not.toBeNull();
  });

  it("asks again on a later press while the context has still not started", async () => {
    const resume = vi.fn<() => Promise<void>>(() => new Promise<void>(() => {}));
    vi.stubGlobal("window", {
      AudioContext: class extends FakeContext {
        override resume = resume;
      },
    });
    const { unlockAudio } = await import("../src/audio/engine.ts");
    const target = new EventTarget();
    unlockAudio(target);
    // A finger's touch does not allow sound to start; its lift does.
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("touchend"));
    expect(resume).toHaveBeenCalledTimes(2);
  });
});
