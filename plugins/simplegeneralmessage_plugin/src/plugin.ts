import {
  ActionExecutor,
  assertArray,
  CommonPluginEnv,
  ContractFilter,
  ParsedVaaWithBytes,
  Plugin,
  Providers,
  sleep,
  StagingAreaKeyLock,
  Workflow,
  WorkflowOptions,
} from "relayer-engine";
import * as wh from "@certusone/wormhole-sdk";
import { Logger } from "winston";
import { parseVaa } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

export interface DummyPluginConfig {
  spyServiceFilters: { chainId: wh.ChainId; emitterAddress: string }[];
}

// Serialized version of WorkloadPayload
// This is what is returned by the consumeEvent and received by handleWorkflow
interface WorkflowPayload {
  vaa: string; // base64
  count: number;
}

// Deserialized version of WorkloadPayload
interface WorkflwoPayloadDeserialized {
  vaa: ParsedVaaWithBytes;
  count: number;
}

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1) + min);

export class DummyPlugin implements Plugin<WorkflowPayload> {
  // configuration fields used by engine
  readonly shouldSpy: boolean = true;
  readonly shouldRest: boolean = false;
  readonly maxRetries = 10;
  static readonly pluginName: string = "DummyPlugin";
  readonly pluginName = DummyPlugin.pluginName;

  // config used by plugin
  pluginConfig: DummyPluginConfig;

  constructor(
    readonly engineConfig: CommonPluginEnv,
    pluginConfigRaw: Record<string, any>,
    readonly logger: Logger,
  ) {
    console.log(`Config: ${JSON.stringify(engineConfig, undefined, 2)}`);
    console.log(`Plugin Env: ${JSON.stringify(pluginConfigRaw, undefined, 2)}`);

    this.pluginConfig = {
      spyServiceFilters:
        pluginConfigRaw.spyServiceFilters &&
        assertArray(pluginConfigRaw.spyServiceFilters, "spyServiceFilters"),
    };
  }

  // =============================== 1. Filter Messages ====================================

  // Filters are automatically inserted by what's stored in ../config/devnet.json 
  // These are the built-in large filters. You can do more filtering in consumeEvent
  getFilters(): ContractFilter[] {
    return this.pluginConfig.spyServiceFilters;
  }

  // ============================ 2. Consume Events from Spy ===============================

  async consumeEvent(
    vaa: ParsedVaaWithBytes,
    stagingArea: StagingAreaKeyLock,
  ): Promise<
    | {
        workflowData: WorkflowPayload;
        workflowOptions?: WorkflowOptions;
      }
    | undefined
  > {
    this.logger.debug(`VAA hash: ${vaa.hash.toString("base64")}`);

    this.logger.debug(`VAA bytes:`);
    this.logger.debug(`${vaa.bytes.toString('hex')}`);

    // Filtering for the destination
    let payload: string = vaa.payload.toString('hex');
    let to = payload.substring(134, 198);
    if (to !== "0000000000000000000000000000000000000000000000000000000000000815") return;

    // Example of reading and updating a key exclusively
    // This allows multiple listeners to run in separate processes safely
    const count = await stagingArea.withKey(
      ["counter"],
      async ({ counter }) => {
        this.logger.debug(`Original counter value ${counter}`);
        counter = (counter ? counter : 0) + 1;
        this.logger.debug(`Counter value after update ${counter}`);
        return {
          newKV: { counter },
          val: counter,
        };
      },
    );

    // For now, we don't really need a transaction.
    return;

    return {
      workflowData: {
        count,
        vaa: vaa.bytes.toString("base64"),
      },
    };
  }

  // ============================ 3. Handle Workflows from Events ===============================

  async handleWorkflow(
    workflow: Workflow,
    providers: Providers,
    execute: ActionExecutor,
  ): Promise<void> {
    this.logger.info("Got workflow", { workflowId: workflow.id });
    this.logger.debug(JSON.stringify(workflow, undefined, 2));

    const { vaa, count } = this.parseWorkflowPayload(workflow);

    // TODO: do a transaction with 0x0000000000000000000000000000000000000815 at some point

    // Dummy job illustrating how to run an action on the wallet worker pool
    const pubkey = await execute.onEVM({
      chainId: 6, // EVM chain to get a wallet for
      f: async (wallet, chainId) => {
        const pubkey = wallet.wallet.address;
        this.logger.info(
          `Inside action, have wallet pubkey ${pubkey} on chain ${chainId}`,
          { pubKey: pubkey, chainId: chainId },
        );
        this.logger.info(`Also have parsed vaa. seq: ${vaa.sequence}`, {
          vaa: vaa,
        });
        return pubkey;
      },
    });

    // Simulate different processing times for metrics
    await sleep(randomInt(0, 4000));

    let PROBABILITY_OF_FAILURE = 0.01;
    if (Math.random() < PROBABILITY_OF_FAILURE) {
      throw new Error("Simulating workflow failure");
    }

    this.logger.info(`Result of action on fuji ${pubkey}, Count: ${count}`);
  }

  parseWorkflowPayload(workflow: Workflow): WorkflwoPayloadDeserialized {
    const bytes = Buffer.from(workflow.data.vaa, "base64");
    const vaa = parseVaa(bytes) as ParsedVaaWithBytes;
    vaa.bytes = bytes;
    return {
      vaa,
      count: workflow.data.count as number,
    };
  }
}

/*

payloadId:      03
amount:         0000000000000000000000000000000000000000000000000000000001312d00
tokenAddress:   000000000000000000000000f1277d1ed8ad466beddf92ef448a132661956621
tokenChain:     000a
to:             0000000000000000000000000000000000000000000000000000000000000815
toChain:        0010
fromAddress:    000000000000000000000000b7e8c35609ca73277b2207d07b51c9ac5798b380
payload:        000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000807b2022706172656e7473223a20312c2022696e746572696f72223a207b20225832223a205b207b202250617261636861696e223a20383838207d2c207b20224163636f756e744b65793230223a202230783335344231304434376538344130303662394537653636413232394431373445384646324130363322207d205d7d7d

*/
