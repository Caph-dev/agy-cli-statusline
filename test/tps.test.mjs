import assert from 'node:assert/strict';
import test from 'node:test';
import { createTpsMeasurement } from '../lib/tps.mjs';

function response(index, state, text, tokens) {
  return {
    event: 'step_update',
    step_update: {
      conversation_id: 'fixture', step_index: index, step_type: 'agent_response',
      state, text_delta: text, usage: tokens == null ? undefined : { output_tokens: tokens },
    },
  };
}

test('generation rate uses the summed visible intervals rather than startup, tools, or DONE without text', () => {
  const measurement = createTpsMeasurement();
  assert.equal(measurement.add(response(1, 'ACTIVE', 'First '), 1500), 'First ');
  measurement.add(response(1, 'ACTIVE', 'response'), 2000);
  measurement.add(response(1, 'DONE', '', 10), 2200);
  measurement.add(response(3, 'ACTIVE', 'Second '), 4000);
  assert.equal(measurement.add(response(3, 'DONE', 'response', 50), 5500), 'response');
  measurement.add({ event: 'result', result: { status: 'SUCCESS' } }, 5700);
  assert.deepEqual(measurement.summarize(), {
    status: 'SUCCESS', firstText: 1500, measuredSteps: 2, textSteps: 2,
    outputTokens: 60, durationMs: 2000, rate: 30,
  });
});

test('whitespace, a single visible chunk and missing usage do not produce a rate', () => {
  const measurement = createTpsMeasurement();
  measurement.add(response(1, 'ACTIVE', ' \n'), 100);
  measurement.add(response(1, 'DONE', 'one chunk', 25), 400);
  measurement.add(response(2, 'ACTIVE', 'part'), 1000);
  measurement.add(response(2, 'DONE', 'two'), 2000);
  measurement.add(response(3, 'ACTIVE', 'unfinished'), 3000);
  measurement.add({ event: 'result', result: { status: 'SUCCESS' } }, 3100);
  assert.deepEqual(measurement.summarize(), {
    status: 'SUCCESS', firstText: 400, measuredSteps: 0, textSteps: 2,
    outputTokens: 0, durationMs: 0, rate: null,
  });
});
