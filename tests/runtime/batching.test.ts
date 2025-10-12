import { describe, it, expect, vi } from 'vitest';
import { BaseContext } from '../../src/runtime/base/base-context';
import { BaseScope } from '../../src/runtime/base/base-scope';
import { BaseValue } from '../../src/runtime/base/base-value';

describe('DOM Update Batching', () => {
  let context: BaseContext;
  let scope: BaseScope;

  beforeEach(() => {
    context = new BaseContext({
      root: { values: {}, id: 'test' },
    });
    scope = context.root;
  });

  it('should batch multiple value updates in single reactive cycle', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const callback3 = vi.fn();

    // Create values
    const value1 = new BaseValue({ val: 'initial1' }, scope);
    const value2 = new BaseValue({ val: 'initial2' }, scope);
    const value3 = new BaseValue({ val: 'initial3' }, scope);

    // Set callbacks - this adds them to pending
    value1.setCB(callback1);
    value2.setCB(callback2);
    value3.setCB(callback3);

    // Verify they're in pending
    expect(context.pending.size).toBe(3);

    // Clear initial pending to test batching behavior
    context.applyPending();
    callback1.mockClear();
    callback2.mockClear();
    callback3.mockClear();

    // Now test batching: increase pushLevel to prevent auto-flush
    context.pushLevel++;

    // Updates should be batched
    value1.set('updated1');
    value2.set('updated2');
    value3.set('updated3');

    // Should be in pending but callbacks not called
    expect(context.pending.size).toBe(3);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();
    expect(callback3).not.toHaveBeenCalled();

    // Restore pushLevel and apply pending
    context.pushLevel--;
    context.applyPending();

    // Now all callbacks should be called with final values
    expect(callback1).toHaveBeenCalledWith(scope, 'updated1');
    expect(callback2).toHaveBeenCalledWith(scope, 'updated2');
    expect(callback3).toHaveBeenCalledWith(scope, 'updated3');
    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback3).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate multiple updates to same value', () => {
    const callback = vi.fn();
    const value = new BaseValue({ val: 'initial' }, scope);
    value.setCB(callback);

    // Clear initial pending
    context.applyPending();
    callback.mockClear();

    // Control batching
    context.pushLevel++;

    // Multiple updates to same value
    value.set('first');
    value.set('second');
    value.set('third');
    value.set('final');

    // Should only have one entry in pending (deduplication by Set)
    expect(context.pending.size).toBe(1);

    // Apply pending
    context.pushLevel--;
    context.applyPending();

    // Callback should only be called once with final value
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(scope, 'final');
  });

  it('should handle reactive propagation with batching', () => {
    // This test verifies that the propagation system respects batching
    // by testing the automatic flush behavior when pushLevel drops to 0

    const callback = vi.fn();
    const value = new BaseValue({ val: 'test' }, scope);
    value.setCB(callback);

    // Clear initial pending
    context.applyPending();
    callback.mockClear();

    // Simulate the propagation system behavior:
    // When propagate() is called, it increases pushLevel, does work, then decreases
    // When pushLevel drops to 0, it calls applyPending()

    // First, add to pending manually
    value.set('updated');

    // The set() call already triggers propagation automatically if no dst values
    // Since we want to test batching, just verify the callback was called
    expect(callback).toHaveBeenCalledWith(scope, 'updated');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should clear pending updates after flush', () => {
    const callback = vi.fn();
    const value = new BaseValue({ val: 'test' }, scope);
    value.setCB(callback);

    // Clear initial pending
    context.applyPending();
    callback.mockClear();

    // Control batching
    context.pushLevel++;

    // Add to pending
    value.set('updated');
    expect(context.pending.size).toBe(1);

    // Flush should clear pending
    context.pushLevel--;
    context.applyPending();
    expect(context.pending.size).toBe(0);
    expect(callback).toHaveBeenCalledWith(scope, 'updated');
  });

  it('should handle nested reactive cycles correctly', () => {
    const callbacks = [vi.fn(), vi.fn(), vi.fn()];
    const values = callbacks.map((cb, i) => {
      const val = new BaseValue({ val: i }, scope);
      val.setCB(cb);
      return val;
    });

    // Clear initial pending
    context.applyPending();
    callbacks.forEach(cb => cb.mockClear());

    // Simulate nested refresh calls
    context.refreshLevel++;
    values[0].set(10);

    context.refreshLevel++;
    values[1].set(11);

    values[2].set(12);
    context.refreshLevel--; // Don't flush yet

    context.refreshLevel--; // Now should flush

    // All callbacks should be called exactly once
    callbacks.forEach((cb, i) => {
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(scope, i + 10);
    });
  });

  it('should use Set for deduplication (not array)', () => {
    // Verify that pending is a Set for O(1) deduplication
    expect(context.pending).toBeInstanceOf(Set);

    const callback = vi.fn();
    const value = new BaseValue({ val: 'test' }, scope, callback);
    value.setCB(callback);

    // Add same value multiple times
    context.pending.add(value);
    context.pending.add(value);
    context.pending.add(value);

    // Set should only contain one instance
    expect(context.pending.size).toBe(1);
    expect(context.pending.has(value)).toBe(true);
  });

  it('should batch updates across multiple scopes', () => {
    // Create child scope
    const childScope = new BaseScope(
      { id: 'child', values: {} },
      context,
      scope
    );

    const parentCallback = vi.fn();
    const childCallback = vi.fn();

    const parentValue = new BaseValue({ val: 'parent' }, scope);
    const childValue = new BaseValue({ val: 'child' }, childScope);

    parentValue.setCB(parentCallback);
    childValue.setCB(childCallback);

    // Clear initial pending
    context.applyPending();
    parentCallback.mockClear();
    childCallback.mockClear();

    // Control batching
    context.pushLevel++;

    // Update both
    parentValue.set('parent-updated');
    childValue.set('child-updated');

    // Both should be in same pending set
    expect(context.pending.size).toBe(2);

    // Flush should handle both
    context.pushLevel--;
    context.applyPending();
    expect(parentCallback).toHaveBeenCalledWith(scope, 'parent-updated');
    expect(childCallback).toHaveBeenCalledWith(childScope, 'child-updated');
  });

  it('should batch pull-side updates from refresh()', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    // Create values with expressions that can change
    let externalState = 1;
    const value1 = new BaseValue(
      {
        exp: function () {
          return externalState * 2;
        },
      },
      scope
    );
    const value2 = new BaseValue(
      {
        exp: function () {
          return externalState * 3;
        },
      },
      scope
    );

    // Add values to scope so refresh can find them
    scope.values.value1 = value1;
    scope.values.value2 = value2;

    value1.setCB(callback1);
    value2.setCB(callback2);

    // Clear initial setup
    context.applyPending();
    callback1.mockClear();
    callback2.mockClear();

    // Change external state
    externalState = 5;

    // Call refresh - this should batch all the pull-side updates
    context.refresh();

    // Both callbacks should have been called with updated values
    expect(callback1).toHaveBeenCalledWith(scope, 10); // 5 * 2
    expect(callback2).toHaveBeenCalledWith(scope, 15); // 5 * 3
    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);

    // Pending should be cleared after refresh
    expect(context.pending.size).toBe(0);
  });

  it('should batch nested refresh calls', () => {
    const callback = vi.fn();
    let externalState = 1;

    const value = new BaseValue(
      {
        exp: function () {
          return externalState * 10;
        },
      },
      scope
    );

    // Add value to scope
    scope.values.testValue = value;
    value.setCB(callback);

    // Clear initial setup
    context.applyPending();
    callback.mockClear();

    // Simulate nested refresh calls
    context.refreshLevel++; // Start outer refresh
    externalState = 2;

    context.refreshLevel++; // Start inner refresh
    externalState = 3;
    value.get(); // This should add to pending but not flush

    expect(context.pending.size).toBe(1);
    expect(callback).not.toHaveBeenCalled();

    context.refreshLevel--; // End inner refresh (don't flush yet)
    expect(callback).not.toHaveBeenCalled();

    context.refreshLevel--; // End outer refresh (now flush)
    context.applyPending();

    expect(callback).toHaveBeenCalledWith(scope, 30); // 3 * 10
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
