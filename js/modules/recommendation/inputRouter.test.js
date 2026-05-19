import { describe, it, expect } from 'vitest';
import { routeInput } from './inputRouter.js';

describe('inputRouter', () => {
    it('should classify navigation correctly', () => {
        const result = routeInput('Find me a lesson, please');
        expect(result.intent).toBe('navigation');
        expect(result.navigationEvent).toBe('FIND_LESSON');
    });

    it('should classify short inputs as out of scope', () => {
        const result = routeInput('ok');
        expect(result.intent).toBe('out_of_scope');
    });

    it('should classify english topics', () => {
        const result = routeInput('How do you say apple in English?');
        expect(result.intent).toBe('english');
    });

    it('should default to ambiguous if no signals hit', () => {
        const result = routeInput('I want to learn more');
        expect(result.intent).toBe('ambiguous');
    });
});
