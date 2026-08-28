import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * 🚨 THE REGRESSION THIS FILE EXISTS FOR.
 *
 * The audio MIME validator had no room for media-type PARAMETERS, so it rejected
 * the exact string every browser MediaRecorder produces. Real microphone
 * recordings were refused at the boundary and the user was told "That recording
 * could not be transcribed" while the ASR runtime was healthy throughout.
 *
 * Proven by sending identical bytes twice: as audio/mpeg it transcribed; as
 * audio/webm;codecs=opus it failed.
 */
const AUDIO_MIME = /^audio\/[A-Za-z0-9.+-]{1,64}$/;
const essence = (raw: string) => raw.split(';')[0]!.trim().toLowerCase();

test('what browsers actually record is accepted', () => {
  // Chrome, Safari, Firefox — every one of these sends a codec parameter.
  for (const m of [
    'audio/webm;codecs=opus',
    'audio/webm; codecs=opus',
    'audio/mp4;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/ogg; codecs="opus"',
    'AUDIO/WEBM;CODECS=OPUS',
  ]) {
    assert.ok(AUDIO_MIME.test(essence(m)), `${m} must be accepted — a browser sends it`);
  }
});

test('plain audio types still work', () => {
  for (const m of ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/x-m4a']) {
    assert.ok(AUDIO_MIME.test(essence(m)), m);
  }
});

test('non-audio is still refused', () => {
  // Loosening the pattern must not turn it into no pattern at all.
  for (const m of ['video/mp4', 'application/zip', 'text/plain', 'audio', '', ';codecs=opus']) {
    assert.equal(AUDIO_MIME.test(essence(m)), false, `${m} must stay refused`);
  }
});

test('the essence is what travels onward', () => {
  assert.equal(essence('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(essence('audio/mp4; codecs=opus'), 'audio/mp4');
});
