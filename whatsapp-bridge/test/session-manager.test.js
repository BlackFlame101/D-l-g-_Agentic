import test from 'node:test';
import assert from 'node:assert/strict';
import { __testUtils } from '../src/session-manager.js';

test('dedup marks second delivery as duplicate', () => {
  __testUtils.resetInboundMessageCaches();
  const msg = {
    key: {
      id: 'abc123',
      remoteJid: '212600000000@s.whatsapp.net',
      fromMe: false,
    },
    messageTimestamp: 123,
    message: { conversation: 'hello' },
  };
  const key = __testUtils.getInboundDedupKey(msg);
  assert.equal(__testUtils.isDuplicateInboundMessage(key), false);
  assert.equal(__testUtils.isDuplicateInboundMessage(key), true);
});

test('system/protocol messages are ignored', () => {
  __testUtils.resetInboundMessageCaches();
  const protocolMessage = {
    key: {
      id: 'sys1',
      remoteJid: '212600000000@s.whatsapp.net',
      fromMe: false,
    },
    message: { protocolMessage: { type: 0 } },
  };
  assert.equal(__testUtils.shouldProcessIncomingMessage(protocolMessage), false);
});

test('direct user chat text messages are accepted', () => {
  __testUtils.resetInboundMessageCaches();
  const userMessage = {
    key: {
      id: 'usr1',
      remoteJid: '212600000000@s.whatsapp.net',
      fromMe: false,
    },
    message: { conversation: 'hello' },
  };
  assert.equal(__testUtils.shouldProcessIncomingMessage(userMessage), true);
});

test('direct LID user chat messages are accepted', () => {
  __testUtils.resetInboundMessageCaches();
  const lidMessage = {
    key: {
      id: 'lid1',
      remoteJid: '209585881280569:38@lid',
      fromMe: false,
    },
    message: { conversation: 'hello from lid' },
  };
  assert.equal(__testUtils.shouldProcessIncomingMessage(lidMessage), true);
});
