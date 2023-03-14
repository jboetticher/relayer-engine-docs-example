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
  WorkflowOptions
} from "relayer-engine";
import * as wh from "@certusone/wormhole-sdk";
import { Logger } from "winston";
import { ChainId, parseVaa, isEVMChain } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import * as abi from "./abi.json";

export interface SimpleGeneralMessagePluginConfig {
  spyServiceFilters: { chainId: wh.ChainId; emitterAddress: string }[];
}

// Serialized version of WorkloadPayload
// This is what is returned by the consumeEvent and received by handleWorkflow
interface WorkflowPayload {
  vaa: string; // base64
  count: number;
}

export class SimpleGeneralMessagePlugin implements Plugin<WorkflowPayload> {
  // configuration fields used by engine
  readonly shouldSpy: boolean = true;
  readonly shouldRest: boolean = false;
  readonly maxRetries = 10;
  static readonly pluginName: string = "DummyPlugin";
  readonly pluginName = SimpleGeneralMessagePlugin.pluginName;

  // config used by plugin
  pluginConfig: SimpleGeneralMessagePluginConfig;

  /*====================== Initialization of the Plugin =======================*/

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

  /*===================== Listener Component of the Plugin =====================*/

  // Filters are automatically inserted by what's stored in ../config/devnet.json 
  // These are the built-in filters. You can do more filtering in consumeEvent if desired
  getFilters(): ContractFilter[] {
    if (this.pluginConfig.spyServiceFilters) {
      return this.pluginConfig.spyServiceFilters;
    }
    this.logger.error("Contract filters not specified in config");
    throw new Error("Contract filters not specified in config");
  }

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

    return {
      workflowData: {
        count,
        vaa: vaa.bytes.toString("base64"),
      },
    };
  }

  /*===================== Executor Component of the Plugin =====================*/

  // Consumes a workflow for execution
  async handleWorkflow(
    workflow: Workflow,
    providers: Providers,
    execute: ActionExecutor
  ): Promise<void> {
    this.logger.info(`Workflow ${workflow.id} received...`);

    const { vaa } = this.parseWorkflowPayload(workflow);
    const parsed = wh.parseVaa(vaa);
    this.logger.info(`Parsed VAA. seq: ${parsed.sequence}`);

    // Here we are parsing the payload so that we can send it to the right recipient
    const hexPayload = parsed.payload.toString("hex");
    let [recipient, destID, sender, message] = ethers.utils.defaultAbiCoder.decode(["bytes32", "uint16", "bytes32", "string"], "0x" + hexPayload);
    recipient = this.formatAddress(recipient);
    sender = this.formatAddress(sender);
    const destChainID = destID as ChainId;
    this.logger.info(`VAA: ${sender} sent "${message}" to ${recipient} on chain ${destID}.`);

    // Execution logic
    if (wh.isEVMChain(destChainID)) {
      // This is where you do all of the EVM execution.
      // Add your own private wallet for the executor to inject in relayer-engine-config/executor.json
      await execute.onEVM({
        chainId: destChainID,
        f: async (wallet, chainId) => {
          const contract = new ethers.Contract(recipient, abi, wallet.wallet);
          const result = await contract.processMyMessage(vaa);
          this.logger.info(result);
        },
      });
    }
    else {
      // The relayer plugin has a built-in Solana wallet handler, which you could use here.
      // NEAR & Algorand are supported by Wormhole, but they're not supported by the relayer plugin.
      // If you want to interact with NEAR or Algorand you'd have to make your own wallet management system, that's all.      
      this.logger.error("Requested chainID is not an EVM chain, which is currently unsupported.");
    }
  }

  // Parses a workflow into the VAA, and when it was received.
  parseWorkflowPayload(workflow: Workflow): { vaa: Buffer } {
    return {
      vaa: Buffer.from(workflow.data.vaa, "base64")
    };
  }

  // Formats bytes32 data to an ethereum style address if necessary.
  formatAddress(address: string): string {
    if (address.startsWith("0x000000000000000000000000")) return "0x" + address.substring(26);
    else return address;
  }
}

