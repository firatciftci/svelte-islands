const state = $state({ version: 0 });

export const arrivals = {
  get version() {
    return state.version;
  },
  bump() {
    state.version++;
  },
};
