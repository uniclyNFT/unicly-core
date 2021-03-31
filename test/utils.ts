import { providers, BigNumber } from 'ethers'

export const DELAY = 60 * 60 * 24 * 2

export async function mineBlock(provider: providers.Web3Provider, timestamp: number): Promise<void> {
  return provider.send('evm_mine', [timestamp])
}

export async function mineBlocks(provider: providers.Web3Provider, timestamp: number, n: number): Promise<void> {
  if(n < 1){
    return provider.send('evm_mine', [timestamp]);
  }
  else{
    for(let i = 0; i < n-1; i++) {
      await provider.send('evm_mine', [timestamp])
    }
    return provider.send('evm_mine', [timestamp]);
  }
}

export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}