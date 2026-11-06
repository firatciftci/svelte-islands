const slow = Number(new URL(location.href).searchParams.get("slow"));

if (slow > 0) {
  const plain = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/_parts/") && !url.endsWith("skeletons.json")) {
      await new Promise((resolve) => {
        setTimeout(resolve, slow);
      });
    }
    return plain(input, init);
  };
}
