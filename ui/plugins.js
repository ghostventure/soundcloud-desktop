(() => {
  const plugins = [];
  window.artistPlugins = plugins;
  window.registerArtistPlugin = plugin => {
    if (!plugin || !/^[a-z][a-z0-9-]*$/.test(plugin.id || '') || plugins.some(p => p.id === plugin.id)) {
      throw new Error('Invalid or duplicate artist workspace plugin.');
    }
    plugins.push(plugin);
  };
})();
