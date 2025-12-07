import { initialProjectCreationProcessor } from './initialProjectCreation.js';
import { projectModificationProcessor } from './projectModification.js';
import flyioSecretsSyncProcessor from './flyioSecretsSyncProcessor.js';

const registry = {
    initialProjectCreationJob: initialProjectCreationProcessor,
    projectModificationJob: projectModificationProcessor,
    'sync-flyio-secrets': flyioSecretsSyncProcessor,
};

/**
 * Look up the processor bound to a job name.
 */
export const getProcessor = (jobName) => registry[jobName];

/**
 * Allow new job handlers to be registered from other modules.
 */
export const registerProcessor = (jobName, processor) => {
  registry[jobName] = processor;
};

/**
 * Expose the current registry mainly for logging/observability.
 */
export const listProcessors = () => Object.keys(registry);
