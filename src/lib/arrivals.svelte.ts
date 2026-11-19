let version = $state(0);

export const arrivals = {
  get version() {
    return version;
  },
  bump() {
    version++;
  },
};
