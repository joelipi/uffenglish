import { createActor } from 'xstate';
import { conversationMachine } from './conversationMachine.js';

const actor = createActor(conversationMachine);
actor.start();

export const conversationService = {
  send: (event) => actor.send(event),
  subscribe: (listener) => actor.subscribe(listener),
  getSnapshot: () => actor.getSnapshot(),
  // We add this to hydrate the machine with data before it starts filtering
  hydrate: (data) => actor.send({ type: 'HYDRATE', ...data })
};
