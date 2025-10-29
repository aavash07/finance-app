module.exports = function expoBabel(api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};