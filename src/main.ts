import * as relayerEngine from "relayer-engine";
import {
  SimpleGeneralMessagePlugin,
  SimpleGeneralMessagePluginConfig,
} from "../plugins/simplegeneralmessage_plugin/src/plugin";

async function main() {
  // load plugin config
  const pluginConfig = (await relayerEngine.loadFileAndParseToObject(
    `./plugins/simplegeneralmessage_plugin/config/${relayerEngine.EnvType.DEVNET.toLowerCase()}.json`,
  )) as SimpleGeneralMessagePluginConfig;

  const mode =
    (process.env.RELAYER_ENGINE_MODE?.toUpperCase() as relayerEngine.Mode) ||
    relayerEngine.Mode.BOTH;

  // run relayer engine
  await relayerEngine.run({
    configs: "./relayer-engine-config",
    plugins: {
      [SimpleGeneralMessagePlugin.pluginName]: (engineConfig, logger) =>
        new SimpleGeneralMessagePlugin(engineConfig, pluginConfig, logger),
    },

    mode,
  });
}

// allow main to be an async function and block until it rejects or resolves
main().catch(e => {
  console.error(e);
  console.error(e.stackTrace);
  process.exit(1);
});
