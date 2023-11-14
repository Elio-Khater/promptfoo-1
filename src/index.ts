import invariant from 'tiny-invariant';

import assertions from './assertions';
import providers, { loadApiProvider } from './providers';
import telemetry from './telemetry';
import { disableCache } from './cache';
import { evaluate as doEvaluate } from './evaluator';
import { loadApiProviders } from './providers';
import { readTests } from './testCases';
import { readFilters, writeLatestResults, writeMultipleOutputs, writeOutput } from './util';
import type { EvaluateOptions, TestSuite, EvaluateTestSuite, ProviderOptions } from './types';

export * from './types';

export { generateTable } from './table';

async function evaluate(testSuite: EvaluateTestSuite, options: EvaluateOptions = {}) {
  const constructedTestSuite: TestSuite = {
    ...testSuite,
    providers: await loadApiProviders(testSuite.providers, {
      env: testSuite.env,
    }),
    tests: await readTests(testSuite.tests),

    nunjucksFilters: readFilters(testSuite.nunjucksFilters || {}),

    // Full prompts expected (not filepaths)
    prompts:
      isOpenAIMessagesObjects(testSuite.prompts) ? [{
        raw: JSON.stringify(testSuite.prompts),
        display: JSON.stringify(testSuite.prompts),
      }] :
        testSuite.prompts.map((promptContent) =>
          typeof promptContent === 'string'
            ? {
              raw: promptContent,
              display: promptContent,
            }
            : {
              raw: JSON.stringify(promptContent),
              display: JSON.stringify(promptContent),
            },
        ),
  };

  // Resolve nested providers
  for (const test of constructedTestSuite.tests || []) {
    if (test.options?.provider && typeof test.options.provider === 'function') {
      test.options.provider = await loadApiProvider(test.options.provider);
    }
    if (test.assert) {
      for (const assertion of test.assert) {
        if (assertion.provider) {
          if (typeof assertion.provider === 'object') {
            const casted = assertion.provider as ProviderOptions;
            invariant(casted.id, 'Provider object must have an id');
            assertion.provider = await loadApiProvider(casted.id, { options: casted });
          } else if (typeof assertion.provider === 'string') {
            assertion.provider = await loadApiProvider(assertion.provider);
          } else {
            // It's a function, no need to do anything
          }
        }
      }
    }
  }

  // Other settings
  if (options.cache === false) {
    disableCache();
  }
  telemetry.maybeShowNotice();

  // Run the eval!
  const ret = await doEvaluate(constructedTestSuite, options);

  if (testSuite.outputPath) {
    if (typeof testSuite.outputPath === 'string') {
      writeOutput(testSuite.outputPath, ret, testSuite, null);
    } else if (Array.isArray(testSuite.outputPath)) {
      writeMultipleOutputs(testSuite.outputPath, ret, testSuite, null);
    }
  }

  if (testSuite.writeLatestResults) {
    writeLatestResults(ret, testSuite);
  }

  await telemetry.send();
  return ret;
}

function isOpenAIMessagesObjects(arr: any) {
  if (!Array.isArray(arr)) {
    return false;
  }

  return arr.every((element) => {
    return typeof element === 'object' && element !== null && !Array.isArray(element);
  });
}

export { evaluate, assertions, providers };

export default {
  evaluate,
  assertions,
  providers,
};
