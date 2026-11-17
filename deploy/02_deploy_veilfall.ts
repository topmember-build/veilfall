import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const veilfall = await deploy("Veilfall", {
    from: deployer,
    log: true,
  });

  console.log(`Veilfall contract: `, veilfall.address);
};
export default func;
func.id = "deploy_veilfall"; // id required to prevent reexecution
func.tags = ["Veilfall"];