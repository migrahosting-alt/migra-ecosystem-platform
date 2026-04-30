import { ref, watch, type Ref } from 'vue';

export function useLocalStorageState<T>(key: string, initial: T): Ref<T> {
  const state = ref<T>(initial) as Ref<T>;

  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      state.value = JSON.parse(raw) as T;
    }
  } catch {
    // ignore
  }

  watch(
    state,
    (next) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore
      }
    },
    { deep: true },
  );

  return state;
}

