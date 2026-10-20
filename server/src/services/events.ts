import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@imagination/shared';

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function publish(event: ServerEvent) {
  bus.emit('event', event);
}

export function subscribe(listener: (event: ServerEvent) => void): () => void {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
