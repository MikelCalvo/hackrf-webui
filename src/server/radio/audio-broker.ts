type Subscriber = ReadableStreamDefaultController<Uint8Array>;

export class AudioBroker {
  private readonly subscribers = new Set<Subscriber>();
  private closed = false;

  createStream(): ReadableStream<Uint8Array> {
    let localController: Subscriber | null = null;
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        localController = controller;
        if (this.closed) {
          controller.close();
          return;
        }
        this.subscribers.add(controller);
      },
      cancel: () => {
        if (localController) {
          this.subscribers.delete(localController);
        }
      },
    }, {
      highWaterMark: 4,
    });
  }

  detach(controller: Subscriber): void {
    this.subscribers.delete(controller);
  }

  broadcast(chunk: Uint8Array): void {
    if (this.closed || this.subscribers.size === 0) {
      return;
    }

    for (const controller of [...this.subscribers]) {
      try {
        controller.enqueue(chunk.slice());
      } catch {
        this.subscribers.delete(controller);
      }
    }
  }

  close(): void {
    this.closed = true;
    for (const controller of [...this.subscribers]) {
      try {
        controller.close();
      } catch {
        // Ignore controller close failures.
      }
    }
    this.subscribers.clear();
  }
}
