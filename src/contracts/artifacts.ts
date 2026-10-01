// Auto-generated ABI exports
export const CentralTreasuryYieldVaultABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_usdc",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_usyc",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "admin",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AccessControlBadConfirmation",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "neededRole",
        "type": "bytes32"
      }
    ],
    "name": "AccessControlUnauthorizedAccount",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "accountId",
        "type": "bytes32"
      }
    ],
    "name": "AccountDeregistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "accountId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "AccountRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "accountId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipientWallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "usdcAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "sharesBurned",
        "type": "uint256"
      }
    ],
    "name": "FundsRecalledFromYield",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "accountId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sourceWallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "usdcAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "sharesMinted",
        "type": "uint256"
      }
    ],
    "name": "FundsSweptToYield",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "previousAdminRole",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "newAdminRole",
        "type": "bytes32"
      }
    ],
    "name": "RoleAdminChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "RoleGranted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "RoleRevoked",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "DEFAULT_ADMIN_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DISBURSAL_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "SWEEPER_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "accountShares",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "accountId",
        "type": "bytes32"
      }
    ],
    "name": "deregisterAccount",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "accountId",
        "type": "bytes32"
      }
    ],
    "name": "getAccountAssets",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      }
    ],
    "name": "getRoleAdmin",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "grantRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "hasRole",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "accountId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "usdcAmount",
        "type": "uint256"
      }
    ],
    "name": "recallForAccount",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "accountId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "registerAccount",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "registeredAccounts",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "callerConfirmation",
        "type": "address"
      }
    ],
    "name": "renounceRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "revokeRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes4",
        "name": "interfaceId",
        "type": "bytes4"
      }
    ],
    "name": "supportsInterface",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "accountId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "accountWallet",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "usdcAmount",
        "type": "uint256"
      }
    ],
    "name": "sweepFromAccount",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalVaultShares",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "usdc",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "usyc",
    "outputs": [
      {
        "internalType": "contract IERC4626Yield",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
export const CentralTreasuryYieldVaultBytecode = "0x60c060405234801561000f575f5ffd5b5060405161150c38038061150c83398101604081905261002e9161021f565b6001600160a01b0383166100895760405162461bcd60e51b815260206004820152601460248201527f496e76616c69642055534443206164647265737300000000000000000000000060448201526064015b60405180910390fd5b6001600160a01b0382166100df5760405162461bcd60e51b815260206004820152601460248201527f496e76616c6964205553594320616464726573730000000000000000000000006044820152606401610080565b6001600160a01b0381166101355760405162461bcd60e51b815260206004820152601560248201527f496e76616c69642061646d696e206164647265737300000000000000000000006044820152606401610080565b6001600160a01b03808416608052821660a0526101525f8261015b565b5050505061025f565b5f828152602081815260408083206001600160a01b038516845290915281205460ff166101fb575f838152602081815260408083206001600160a01b03861684529091529020805460ff191660011790556101b33390565b6001600160a01b0316826001600160a01b0316847f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a45060016101fe565b505f5b92915050565b80516001600160a01b038116811461021a575f5ffd5b919050565b5f5f5f60608486031215610231575f5ffd5b61023a84610204565b925061024860208501610204565b915061025660408501610204565b90509250925092565b60805160a05161124d6102bf5f395f81816102c0015281816105c10152818161074f01528181610c8801528181610d810152610f1701525f81816101ea015281816106b3015281816107df01528181610bbb0152610cb7015261124d5ff3fe608060405234801561000f575f5ffd5b506004361061011c575f3560e01c8063728a1611116100a9578063abb3a8471161006e578063abb3a847146102a8578063c166beb6146102bb578063c42b5d35146102e2578063d547741f1461030a578063f288796b1461031d575f5ffd5b8063728a16111461024b57806377f4c79d1461025457806380c8cc8c1461026757806391d148541461028e578063a217fddf146102a1575f5ffd5b80632f2ff15d116100ef5780632f2ff15d146101ac57806336568abe146101bf5780633aef303d146101d25780633e413bee146101e55780635f82abb914610224575f5ffd5b806301ffc9a7146101205780630c93888f14610148578063248a9ca31461015d5780632a2932ee1461018d575b5f5ffd5b61013361012e3660046110d1565b610330565b60405190151581526020015b60405180910390f35b61015b6101563660046110f8565b610366565b005b61017f61016b3660046110f8565b5f9081526020819052604090206001015490565b60405190815260200161013f565b61017f61019b3660046110f8565b60026020525f908152604090205481565b61015b6101ba36600461112a565b610416565b61015b6101cd36600461112a565b610440565b61015b6101e0366004611154565b610478565b61020c7f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b03909116815260200161013f565b61017f7f8aef0597c0be1e090afba1f387ee99f604b5d975ccbed6215cdf146ffd5c49fc81565b61017f60035481565b61015b61026236600461112a565b61098e565b61017f7fbdc7932b2a943e80456055a1495350ada24ab52285a99190c8fc361590bfedc481565b61013361029c36600461112a565b610a88565b61017f5f81565b61015b6102b6366004611174565b610ab0565b61020c7f000000000000000000000000000000000000000000000000000000000000000081565b61020c6102f03660046110f8565b60016020525f90815260409020546001600160a01b031681565b61015b61031836600461112a565b610ec0565b61017f61032b3660046110f8565b610ee4565b5f6001600160e01b03198216637965db0b60e01b148061036057506301ffc9a760e01b6001600160e01b03198316145b92915050565b5f61037081610f8f565b5f82815260026020526040902054156103d05760405162461bcd60e51b815260206004820152601f60248201527f4163636f756e742068617320616374697665207969656c64207368617265730060448201526064015b60405180910390fd5b5f8281526001602052604080822080546001600160a01b03191690555183917ffbf53747903ce3a02c079f91c5230672bc86e89a932788a68b1c49ce1dbd2ed591a25050565b5f8281526020819052604090206001015461043081610f8f565b61043a8383610f9c565b50505050565b6001600160a01b03811633146104695760405163334bd91960e11b815260040160405180910390fd5b610473828261102b565b505050565b7fbdc7932b2a943e80456055a1495350ada24ab52285a99190c8fc361590bfedc46104a281610f8f565b5f838152600160205260409020546001600160a01b0316806104ff5760405162461bcd60e51b81526020600482015260166024820152751058d8dbdd5b9d081b9bdd081c9959da5cdd195c995960521b60448201526064016103c7565b5f83116105435760405162461bcd60e51b815260206004820152601260248201527116995c9bc81c9958d85b1b08185b5bdd5b9d60721b60448201526064016103c7565b5f61054d85610ee4565b9050838110156105aa5760405162461bcd60e51b815260206004820152602260248201527f496e73756666696369656e74206163636f756e74207969656c642062616c616e604482015261636560f01b60648201526084016103c7565b60405163ce96cb7760e01b81523060048201525f907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169063ce96cb7790602401602060405180830381865afa15801561060e573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061063291906111a7565b9050848110156106925760405162461bcd60e51b815260206004820152602560248201527f496e7374616e742055535943206c6971756964697479206c696d697420657863604482015264195959195960da1b60648201526084016103c7565b6040516370a0823160e01b81526001600160a01b0384811660048301525f917f0000000000000000000000000000000000000000000000000000000000000000909116906370a0823190602401602060405180830381865afa1580156106fa573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061071e91906111a7565b604051632d182be560e21b8152600481018890526001600160a01b0386811660248301523060448301529192505f917f0000000000000000000000000000000000000000000000000000000000000000169063b460af94906064016020604051808303815f875af1158015610795573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906107b991906111a7565b6040516370a0823160e01b81526001600160a01b0387811660048301529192505f9184917f0000000000000000000000000000000000000000000000000000000000000000909116906370a0823190602401602060405180830381865afa158015610826573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061084a91906111a7565b61085491906111d2565b9050878110156108a65760405162461bcd60e51b815260206004820152601e60248201527f526564656d7074696f6e20707265636973696f6e2073686f727466616c6c000060448201526064016103c7565b5f898152600260205260409020548211156109035760405162461bcd60e51b815260206004820152601b60248201527f53686172652063616c63756c6174696f6e20756e646572666c6f77000000000060448201526064016103c7565b5f89815260026020526040812080548492906109209084906111d2565b925050819055508160035f82825461093891906111d2565b909155505060408051898152602081018490526001600160a01b038816918b917f0c8968db657eb23cadcae66238907477756a087c57fe7dbe3cc41a47db9156e1910160405180910390a3505050505050505050565b5f61099881610f8f565b826109d95760405162461bcd60e51b8152602060048201526011602482015270125b9d985b1a59081858d8dbdd5b9d1259607a1b60448201526064016103c7565b6001600160a01b038216610a2f5760405162461bcd60e51b815260206004820152601c60248201527f43616e6e6f74207265676973746572207a65726f20616464726573730000000060448201526064016103c7565b5f8381526001602052604080822080546001600160a01b0319166001600160a01b0386169081179091559051909185917fa53ef215e87f792a9d93bf09306d3884bbb095ca69f4d58e12a203bb7c641fbc9190a3505050565b5f918252602082815260408084206001600160a01b0393909316845291905290205460ff1690565b7f8aef0597c0be1e090afba1f387ee99f604b5d975ccbed6215cdf146ffd5c49fc610ada81610f8f565b5f848152600160205260409020546001600160a01b03848116911614610b4c5760405162461bcd60e51b815260206004820152602160248201527f57616c6c6574206e6f74207265676973746572656420666f72206163636f756e6044820152601d60fa1b60648201526084016103c7565b5f8211610b8f5760405162461bcd60e51b815260206004820152601160248201527016995c9bc81cddd9595c08185b5bdd5b9d607a1b60448201526064016103c7565b6040516323b872dd60e01b81526001600160a01b038481166004830152306024830152604482018490527f000000000000000000000000000000000000000000000000000000000000000016906323b872dd906064016020604051808303815f875af1158015610c01573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610c2591906111e5565b610c715760405162461bcd60e51b815260206004820152601860248201527f55534443207472616e7366657246726f6d206661696c6564000000000000000060448201526064016103c7565b60405163095ea7b360e01b81526001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081166004830152602482018490527f0000000000000000000000000000000000000000000000000000000000000000169063095ea7b3906044016020604051808303815f875af1158015610cfd573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610d2191906111e5565b610d635760405162461bcd60e51b81526020600482015260136024820152721554d110c8185c1c1c9bdd994819985a5b1959606a1b60448201526064016103c7565b604051636e553f6560e01b8152600481018390523060248201525f907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690636e553f65906044016020604051808303815f875af1158015610dcf573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610df391906111a7565b90505f8111610e395760405162461bcd60e51b815260206004820152601260248201527116995c9bc81cda185c995cc81b5a5b9d195960721b60448201526064016103c7565b5f8581526002602052604081208054839290610e56908490611204565b925050819055508060035f828254610e6e9190611204565b909155505060408051848152602081018390526001600160a01b0386169187917fdb15e004ea48f421cfff92fcd36ae23d937e7fe5d9eeaa0e49cf3ed74f852d38910160405180910390a35050505050565b5f82815260208190526040902060010154610eda81610f8f565b61043a838361102b565b5f81815260026020526040812054808203610f0157505f92915050565b6040516303d1689d60e11b8152600481018290527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316906307a2d13a90602401602060405180830381865afa158015610f64573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610f8891906111a7565b9392505050565b610f998133611094565b50565b5f610fa78383610a88565b611024575f838152602081815260408083206001600160a01b03861684529091529020805460ff19166001179055610fdc3390565b6001600160a01b0316826001600160a01b0316847f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a4506001610360565b505f610360565b5f6110368383610a88565b15611024575f838152602081815260408083206001600160a01b0386168085529252808320805460ff1916905551339286917ff6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b9190a4506001610360565b61109e8282610a88565b6110cd5760405163e2517d3f60e01b81526001600160a01b0382166004820152602481018390526044016103c7565b5050565b5f602082840312156110e1575f5ffd5b81356001600160e01b031981168114610f88575f5ffd5b5f60208284031215611108575f5ffd5b5035919050565b80356001600160a01b0381168114611125575f5ffd5b919050565b5f5f6040838503121561113b575f5ffd5b8235915061114b6020840161110f565b90509250929050565b5f5f60408385031215611165575f5ffd5b50508035926020909101359150565b5f5f5f60608486031215611186575f5ffd5b833592506111966020850161110f565b929592945050506040919091013590565b5f602082840312156111b7575f5ffd5b5051919050565b634e487b7160e01b5f52601160045260245ffd5b81810381811115610360576103606111be565b5f602082840312156111f5575f5ffd5b81518015158114610f88575f5ffd5b80820180821115610360576103606111be56fea26469706673582212207e95eeabf23e379f173826ef34b06169197e9bd884e92993b862f8c63ed3797364736f6c63430008250033" as const;

export const DisbursalVaultABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_usdc",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_admin",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_perTxCap",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_dailyCap",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_eip712Threshold",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AccessControlBadConfirmation",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "neededRole",
        "type": "bytes32"
      }
    ],
    "name": "AccessControlUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ECDSAInvalidSignature",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "length",
        "type": "uint256"
      }
    ],
    "name": "ECDSAInvalidSignatureLength",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "s",
        "type": "bytes32"
      }
    ],
    "name": "ECDSAInvalidSignatureS",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidShortString",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "str",
        "type": "string"
      }
    ],
    "name": "StringTooLong",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousAdmin",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newAdmin",
        "type": "address"
      }
    ],
    "name": "AdminApproverUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "permissionRequestId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "vendor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "idempotencyKey",
        "type": "bytes32"
      }
    ],
    "name": "DisbursalExecuted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [],
    "name": "EIP712DomainChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "FundsRefunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "previousAdminRole",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "newAdminRole",
        "type": "bytes32"
      }
    ],
    "name": "RoleAdminChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "RoleGranted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "RoleRevoked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "perTxCap",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "dailyCap",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "eip712Threshold",
        "type": "uint256"
      }
    ],
    "name": "SpendingCapsUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "vendor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "approved",
        "type": "bool"
      }
    ],
    "name": "VendorStatusUpdated",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "DEFAULT_ADMIN_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DISBURSAL_TYPEHASH",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "EXECUTOR_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "adminApprover",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "approvedVendors",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "currentDay",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "dailyCap",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "dailySpent",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "eip712ApprovalThreshold",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "eip712Domain",
    "outputs": [
      {
        "internalType": "bytes1",
        "name": "fields",
        "type": "bytes1"
      },
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "version",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "chainId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "verifyingContract",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "uint256[]",
        "name": "extensions",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "permissionRequestId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "vendor",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "idempotencyKey",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "adminSignature",
        "type": "bytes"
      }
    ],
    "name": "executePayment",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "executedIdempotencyKeys",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      }
    ],
    "name": "getRoleAdmin",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "grantRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "hasRole",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "perTxCap",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "refundExcess",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "callerConfirmation",
        "type": "address"
      }
    ],
    "name": "renounceRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "revokeRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_newAdmin",
        "type": "address"
      }
    ],
    "name": "setAdminApprover",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "vendor",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "approved",
        "type": "bool"
      }
    ],
    "name": "setVendorApproval",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes4",
        "name": "interfaceId",
        "type": "bytes4"
      }
    ],
    "name": "supportsInterface",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_perTxCap",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_dailyCap",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_threshold",
        "type": "uint256"
      }
    ],
    "name": "updateCaps",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "usdc",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "usedNonces",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
export const DisbursalVaultBytecode = "0x610180604052348015610010575f5ffd5b50604051611fe9380380611fe983398101604081905261002f916103a4565b6040518060400160405280600e81526020016d111a5cd89d5c9cd85b15985d5b1d60921b815250604051806040016040528060018152602001603160f81b81525061008460018361027360201b90919060201c565b61012052610093816002610273565b61014052815160208084019190912060e052815190820120610100524660a05261011f60e05161010051604080517f8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f60208201529081019290925260608201524660808201523060a08201525f9060c00160405160208183030381529060405280519060200120905090565b60805250503060c0526001600160a01b0385166101835760405162461bcd60e51b815260206004820152601460248201527f496e76616c69642055534443206164647265737300000000000000000000000060448201526064015b60405180910390fd5b6001600160a01b0384166101d95760405162461bcd60e51b815260206004820152601560248201527f496e76616c69642061646d696e20616464726573730000000000000000000000604482015260640161017a565b818311156102295760405162461bcd60e51b815260206004820152601960248201527f70657254784361702065786365656473206461696c7943617000000000000000604482015260640161017a565b6001600160a01b0385811661016052600380546001600160a01b0319169186169190911790556007839055600882905560098190556102685f856102a5565b5050505050506105a7565b5f60208351101561028e576102878361034c565b905061029f565b816102998482610491565b5060ff90505b92915050565b5f828152602081815260408083206001600160a01b038516845290915281205460ff16610345575f838152602081815260408083206001600160a01b03861684529091529020805460ff191660011790556102fd3390565b6001600160a01b0316826001600160a01b0316847f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a450600161029f565b505f61029f565b5f5f829050601f81511115610376578260405163305a27a960e01b815260040161017a919061054f565b805161038182610584565b179392505050565b80516001600160a01b038116811461039f575f5ffd5b919050565b5f5f5f5f5f60a086880312156103b8575f5ffd5b6103c186610389565b94506103cf60208701610389565b6040870151606088015160809098015196999198509695945092505050565b634e487b7160e01b5f52604160045260245ffd5b600181811c9082168061041657607f821691505b60208210810361043457634e487b7160e01b5f52602260045260245ffd5b50919050565b601f82111561048c578282111561048c57805f5260205f20601f840160051c602085101561046557505f5b90810190601f840160051c035f5b81811015610488575f83820155600101610473565b5050505b505050565b81516001600160401b038111156104aa576104aa6103ee565b6104be816104b88454610402565b8461043a565b6020601f8211600181146104f0575f83156104d95750848201515b5f19600385901b1c1916600184901b178455610548565b5f84815260208120601f198516915b8281101561051f57878501518255602094850194600190920191016104ff565b508482101561053c57868401515f19600387901b60f8161c191681555b505060018360011b0184555b5050505050565b602081525f82518060208401528060208501604085015e5f604082850101526040601f19601f83011684010191505092915050565b80516020808301519190811015610434575f1960209190910360031b1b16919050565b60805160a05160c05160e051610100516101205161014051610160516119cb61061e5f395f818161025f015281816104ae0152818161059301528181610b1b0152610c2f01525f6111d201525f6111a001525f61130e01525f6112e601525f61124101525f61126b01525f61129501526119cb5ff3fe608060405234801561000f575f5ffd5b506004361061016d575f3560e01c80636717e41c116100d9578063ad82cbea11610093578063eb3393911161006e578063eb3393911461037a578063ebac650514610383578063ee2ec21514610396578063fe97085f146103a9575f5ffd5b8063ad82cbea1461033c578063d547741f14610345578063e7f6376e14610358575f5ffd5b80636717e41c146102b557806375ba7f7f146102d757806384b0196e146102fe57806391d1485414610319578063a217fddf1461032c578063a267821014610333575f5ffd5b8063248a9ca31161012a578063248a9ca3146102125780632f2ff15d1461023457806336568abe146102475780633e413bee1461025a5780635c6bb23e146102995780635c9302c9146102ac575f5ffd5b806301ffc9a71461017157806307bd0265146101995780630bc6b89c146101ce5780630d8b0dfc146101d75780630fdb901c146101ec5780631c5c7a4d146101ff575b5f5ffd5b61018461017f366004611634565b6103cb565b60405190151581526020015b60405180910390f35b6101c07fd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e6381565b604051908152602001610190565b6101c0600b5481565b6101ea6101e536600461167d565b610401565b005b6101ea6101fa3660046116a5565b61068a565b6101ea61020d366004611750565b610d37565b6101c0610220366004611769565b5f9081526020819052604090206001015490565b6101ea610242366004611780565b610de9565b6101ea610255366004611780565b610e13565b6102817f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b039091168152602001610190565b600354610281906001600160a01b031681565b6101c0600a5481565b6101846102c3366004611769565b60066020525f908152604090205460ff1681565b6101c07fd47d4ca806a1a95a0a20df82d876a876a10a51c5b4712d8c7e40c1d1c14dc2f581565b610306610e4b565b60405161019097969594939291906117d8565b610184610327366004611780565b610e8d565b6101c05f81565b6101c060095481565b6101c060075481565b6101ea610353366004611780565b610eb5565b610184610366366004611750565b60046020525f908152604090205460ff1681565b6101c060085481565b6101ea61039136600461186e565b610ed9565b6101ea6103a43660046118a4565b610f89565b6101846103b7366004611769565b60056020525f908152604090205460ff1681565b5f6001600160e01b03198216637965db0b60e01b14806103fb57506301ffc9a760e01b6001600160e01b03198316145b92915050565b5f61040b81611040565b6001600160a01b03831661045a5760405162461bcd60e51b8152602060048201526011602482015270125b9d985b1a59081c9958da5c1a595b9d607a1b60448201526064015b60405180910390fd5b5f82116104975760405162461bcd60e51b815260206004820152600b60248201526a16995c9bc8185b5bdd5b9d60aa1b6044820152606401610451565b6040516370a0823160e01b815230600482015282907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316906370a0823190602401602060405180830381865afa1580156104fb573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061051f91906118d9565b101561056d5760405162461bcd60e51b815260206004820152601a60248201527f496e73756666696369656e74207661756c742062616c616e63650000000000006044820152606401610451565b60405163a9059cbb60e01b81526001600160a01b038481166004830152602482018490527f0000000000000000000000000000000000000000000000000000000000000000169063a9059cbb906044016020604051808303815f875af11580156105d9573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906105fd91906118f0565b6106425760405162461bcd60e51b81526020600482015260166024820152751499599d5b99081d1c985b9cd9995c8819985a5b195960521b6044820152606401610451565b826001600160a01b03167fbada1a1bf129e41a8af5abe00997bd8a8cb1770cb0cf68314eb4b1d6c42713978360405161067d91815260200190565b60405180910390a2505050565b7fd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e636106b481611040565b6001600160a01b0388165f9081526004602052604090205460ff1661071b5760405162461bcd60e51b815260206004820181905260248201527f56656e646f72206e6f74206f6e206f6e2d636861696e20616c6c6f776c6973746044820152606401610451565b6001600160a01b0388166107695760405162461bcd60e51b815260206004820152601560248201527443616e6e6f7420706179206164647265737328302960581b6044820152606401610451565b5f87116107b05760405162461bcd60e51b815260206004820152601560248201527416995c9bc8191a5cd89d5c9cd85b08185b5bdd5b9d605a1b6044820152606401610451565b5f8681526005602052604090205460ff16156108265760405162461bcd60e51b815260206004820152602f60248201527f4475706c6963617465207472616e73616374696f6e20626c6f636b656420284960448201526e64656d706f74656e6379204b65792960881b6064820152608401610451565b5f610834620151804261190b565b9050600a5481111561084a57600a8190555f600b555b60085488600b5461085b919061192a565b11156108a95760405162461bcd60e51b815260206004820152601b60248201527f4461696c79207370656e64696e672063617020657863656564656400000000006044820152606401610451565b600954881115610aa657844211156109035760405162461bcd60e51b815260206004820152601960248201527f4549502d373132207369676e61747572652065787069726564000000000000006044820152606401610451565b5f8681526006602052604090205460ff16156109615760405162461bcd60e51b815260206004820152601c60248201527f5369676e6174757265206e6f6e636520616c72656164792075736564000000006044820152606401610451565b5f868152600660209081526040808320805460ff1916600117905580517fd47d4ca806a1a95a0a20df82d876a876a10a51c5b4712d8c7e40c1d1c14dc2f59281019290925281018c90526001600160a01b038b166060820152608081018a905260a0810189905260c0810188905260e08101879052610100016040516020818303038152906040528051906020012090505f6109fc8261104d565b90505f610a3e8288888080601f0160208091040260200160405190810160405280939291908181526020018383808284375f9201919091525061107992505050565b6003549091506001600160a01b03808316911614610a9e5760405162461bcd60e51b815260206004820152601f60248201527f496e76616c69642061646d696e204549502d373132207369676e6174757265006044820152606401610451565b505050610b04565b600754881115610b045760405162461bcd60e51b8152602060048201526024808201527f416d6f756e742065786365656473207065722d7478206175746f6e6f6d6f75736044820152630206361760e41b6064820152608401610451565b6040516370a0823160e01b815230600482015288907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316906370a0823190602401602060405180830381865afa158015610b68573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610b8c91906118d9565b1015610bda5760405162461bcd60e51b815260206004820152601860248201527f44697362757273616c207661756c7420756e6261636b656400000000000000006044820152606401610451565b5f878152600560205260408120805460ff19166001179055600b80548a9290610c0490849061192a565b909155505060405163a9059cbb60e01b81526001600160a01b038a81166004830152602482018a90527f0000000000000000000000000000000000000000000000000000000000000000169063a9059cbb906044016020604051808303815f875af1158015610c75573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610c9991906118f0565b610ce55760405162461bcd60e51b815260206004820152601e60248201527f55534443207472616e7366657220746f2076656e646f72206661696c656400006044820152606401610451565b60408051898152602081018990526001600160a01b038b16918c917ffe2f889cf0e37e3a75612cf48ea2551a33b6b2e62c43ea2905b9655fe87879bc910160405180910390a350505050505050505050565b5f610d4181611040565b6001600160a01b038216610d975760405162461bcd60e51b815260206004820181905260248201527f43616e6e6f7420736574207a65726f206164647265737320617070726f7665726044820152606401610451565b600380546001600160a01b038481166001600160a01b0319831681179093556040519116919082907f65a782ca1d50c331e98146fed6242e2f1246fc272611aa5bc3a89f5aa16d0daa905f90a3505050565b5f82815260208190526040902060010154610e0381611040565b610e0d83836110a1565b50505050565b6001600160a01b0381163314610e3c5760405163334bd91960e11b815260040160405180910390fd5b610e468282611130565b505050565b5f6060805f5f5f6060610e5c611199565b610e646111cb565b604080515f80825260208201909252600f60f81b9b939a50919850469750309650945092509050565b5f918252602082815260408084206001600160a01b0393909316845291905290205460ff1690565b5f82815260208190526040902060010154610ecf81611040565b610e0d8383611130565b5f610ee381611040565b82841115610f335760405162461bcd60e51b815260206004820152601960248201527f70657254784361702065786365656473206461696c79436170000000000000006044820152606401610451565b60078490556008839055600982905560408051858152602081018590529081018390527fc727354b6c874c365c1a74ade152ee643a7d1a45f9af28763e53e7b47e9014f69060600160405180910390a150505050565b5f610f9381611040565b6001600160a01b038316610fe95760405162461bcd60e51b815260206004820152601b60248201527f43616e6e6f7420617070726f7665207a65726f206164647265737300000000006044820152606401610451565b6001600160a01b0383165f81815260046020908152604091829020805460ff191686151590811790915591519182527f96d88a87986c7b53fa434046a471576b059398e4f00f9635907fd0bb5b1fcb58910161067d565b61104a81336111f8565b50565b5f6103fb611059611235565b8360405161190160f01b8152600281019290925260228201526042902090565b5f5f5f5f611087868661135e565b92509250925061109782826113a7565b5090949350505050565b5f6110ac8383610e8d565b611129575f838152602081815260408083206001600160a01b03861684529091529020805460ff191660011790556110e13390565b6001600160a01b0316826001600160a01b0316847f2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d60405160405180910390a45060016103fb565b505f6103fb565b5f61113b8383610e8d565b15611129575f838152602081815260408083206001600160a01b0386168085529252808320805460ff1916905551339286917ff6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b9190a45060016103fb565b60606111c67f0000000000000000000000000000000000000000000000000000000000000000600161145f565b905090565b60606111c67f0000000000000000000000000000000000000000000000000000000000000000600261145f565b6112028282610e8d565b6112315760405163e2517d3f60e01b81526001600160a01b038216600482015260248101839052604401610451565b5050565b5f306001600160a01b037f00000000000000000000000000000000000000000000000000000000000000001614801561128d57507f000000000000000000000000000000000000000000000000000000000000000046145b156112b757507f000000000000000000000000000000000000000000000000000000000000000090565b6111c6604080517f8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f60208201527f0000000000000000000000000000000000000000000000000000000000000000918101919091527f000000000000000000000000000000000000000000000000000000000000000060608201524660808201523060a08201525f9060c00160405160208183030381529060405280519060200120905090565b5f5f5f8351604103611395576020840151604085015160608601515f1a61138788828585611508565b9550955095505050506113a0565b505081515f91506002905b9250925092565b5f8260038111156113ba576113ba611949565b036113c3575050565b60018260038111156113d7576113d7611949565b036113f55760405163f645eedf60e01b815260040160405180910390fd5b600282600381111561140957611409611949565b0361142a5760405163fce698f760e01b815260048101829052602401610451565b600382600381111561143e5761143e611949565b03611231576040516335e2f38360e21b815260048101829052602401610451565b606060ff831461147957611472836115d0565b90506103fb565b8180546114859061195d565b80601f01602080910402602001604051908101604052809291908181526020018280546114b19061195d565b80156114fc5780601f106114d3576101008083540402835291602001916114fc565b820191905f5260205f20905b8154815290600101906020018083116114df57829003601f168201915b505050505090506103fb565b5f80807f7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a084111561154157505f915060039050826115c6565b604080515f808252602082018084528a905260ff891692820192909252606081018790526080810186905260019060a0016020604051602081039080840390855afa158015611592573d5f5f3e3d5ffd5b5050604051601f1901519150506001600160a01b0381166115bd57505f9250600191508290506115c6565b92505f91508190505b9450945094915050565b60605f6115dc8361160d565b6040805160208082528183019092529192505f91906020820181803683375050509182525060208101929092525090565b5f60ff8216601f8111156103fb57604051632cd44ac360e21b815260040160405180910390fd5b5f60208284031215611644575f5ffd5b81356001600160e01b03198116811461165b575f5ffd5b9392505050565b80356001600160a01b0381168114611678575f5ffd5b919050565b5f5f6040838503121561168e575f5ffd5b61169783611662565b946020939093013593505050565b5f5f5f5f5f5f5f5f60e0898b0312156116bc575f5ffd5b883597506116cc60208a01611662565b965060408901359550606089013594506080890135935060a0890135925060c089013567ffffffffffffffff811115611703575f5ffd5b8901601f81018b13611713575f5ffd5b803567ffffffffffffffff811115611729575f5ffd5b8b602082840101111561173a575f5ffd5b989b979a50959850939692959194602001935050565b5f60208284031215611760575f5ffd5b61165b82611662565b5f60208284031215611779575f5ffd5b5035919050565b5f5f60408385031215611791575f5ffd5b823591506117a160208401611662565b90509250929050565b5f81518084528060208401602086015e5f602082860101526020601f19601f83011685010191505092915050565b60ff60f81b8816815260e060208201525f6117f660e08301896117aa565b828103604084015261180881896117aa565b606084018890526001600160a01b038716608085015260a0840186905283810360c0850152845180825260208087019350909101905f5b8181101561185d57835183526020938401939092019160010161183f565b50909b9a5050505050505050505050565b5f5f5f60608486031215611880575f5ffd5b505081359360208301359350604090920135919050565b801515811461104a575f5ffd5b5f5f604083850312156118b5575f5ffd5b6118be83611662565b915060208301356118ce81611897565b809150509250929050565b5f602082840312156118e9575f5ffd5b5051919050565b5f60208284031215611900575f5ffd5b815161165b81611897565b5f8261192557634e487b7160e01b5f52601260045260245ffd5b500490565b808201808211156103fb57634e487b7160e01b5f52601160045260245ffd5b634e487b7160e01b5f52602160045260245ffd5b600181811c9082168061197157607f821691505b60208210810361198f57634e487b7160e01b5f52602260045260245ffd5b5091905056fea26469706673582212203f38cf7febe833d84a22aa2777ad2ad03c9b694be9d25641fbcd15dee3786c0464736f6c63430008250033" as const;

export const MockUSYCVaultABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_asset",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "allowance",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "needed",
        "type": "uint256"
      }
    ],
    "name": "ERC20InsufficientAllowance",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "needed",
        "type": "uint256"
      }
    ],
    "name": "ERC20InsufficientBalance",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "approver",
        "type": "address"
      }
    ],
    "name": "ERC20InvalidApprover",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      }
    ],
    "name": "ERC20InvalidReceiver",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "ERC20InvalidSender",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      }
    ],
    "name": "ERC20InvalidSpender",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "Approval",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "Transfer",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "basisPoints",
        "type": "uint256"
      }
    ],
    "name": "accrueYield",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      }
    ],
    "name": "allowance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "approve",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "asset",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      }
    ],
    "name": "convertToAssets",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assets",
        "type": "uint256"
      }
    ],
    "name": "convertToShares",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assets",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      }
    ],
    "name": "deposit",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "maxDeposit",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "maxRedeem",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "maxWithdraw",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "name",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "navExchangeRateMultiplier",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assets",
        "type": "uint256"
      }
    ],
    "name": "previewDeposit",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assets",
        "type": "uint256"
      }
    ],
    "name": "previewWithdraw",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "redeem",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "assets",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalAssets",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "transfer",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "transferFrom",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "underlyingAsset",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assets",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "withdraw",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "shares",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
export const MockUSYCVaultBytecode = "0x60a0604052670de0b6b3a764000060055534801561001b575f5ffd5b5060405161132f38038061132f83398101604081905261003a91610108565b6040518060400160405280601b81526020017f4d6f636b20486173686e6f7465205553205969656c6420436f696e0000000000815250604051806040016040528060058152602001646d5553594360d81b815250816003908161009d91906101d8565b5060046100aa82826101d8565b5050506001600160a01b0381166100f75760405162461bcd60e51b815260206004820152600d60248201526c125b9d985b1a5908185cdcd95d609a1b604482015260640160405180910390fd5b6001600160a01b0316608052610296565b5f60208284031215610118575f5ffd5b81516001600160a01b038116811461012e575f5ffd5b9392505050565b634e487b7160e01b5f52604160045260245ffd5b600181811c9082168061015d57607f821691505b60208210810361017b57634e487b7160e01b5f52602260045260245ffd5b50919050565b601f8211156101d357828211156101d357805f5260205f20601f840160051c60208510156101ac57505f5b90810190601f840160051c035f5b818110156101cf575f838201556001016101ba565b5050505b505050565b81516001600160401b038111156101f1576101f1610135565b610205816101ff8454610149565b84610181565b6020601f821160018114610237575f83156102205750848201515b5f19600385901b1c1916600184901b17845561028f565b5f84815260208120601f198516915b828110156102665787850151825560209485019460019092019101610246565b508482101561028357868401515f19600387901b60f8161c191681555b505060018360011b0184555b5050505050565b60805161105e6102d15f395f81816102110152818161029d015281816103a4015281816106610152818161082201526109a3015261105e5ff3fe608060405234801561000f575f5ffd5b5060043610610153575f3560e01c806370a08231116100bf578063c41eda2811610079578063c41eda2814610300578063c6e6f59214610309578063ce96cb771461031c578063d905777e1461032f578063dd62ed3e14610342578063ef8b30f71461037a575f5ffd5b806370a08231146102705780637158da7c1461029857806395d89b41146102bf578063a9059cbb146102c7578063b460af94146102da578063ba087652146102ed575f5ffd5b806318160ddd1161011057806318160ddd146101e557806323b872dd146101ed578063313ce5671461020057806338d52e0f1461020f578063402d267d146102495780636e553f651461025d575f5ffd5b806301e1d1141461015757806306fdde031461017257806307a2d13a1461018757806308b0b0c81461019a578063095ea7b3146101af5780630a28a477146101d2575b5f5ffd5b61015f61038d565b6040519081526020015b60405180910390f35b61017a61041a565b6040516101699190610db3565b61015f610195366004610de8565b6104aa565b6101ad6101a8366004610de8565b6104e0565b005b6101c26101bd366004610e1a565b61050a565b6040519015158152602001610169565b61015f6101e0366004610de8565b610521565b60025461015f565b6101c26101fb366004610e42565b610560565b60405160068152602001610169565b7f00000000000000000000000000000000000000000000000000000000000000005b6040516001600160a01b039091168152602001610169565b61015f610257366004610e7c565b505f1990565b61015f61026b366004610e95565b610583565b61015f61027e366004610e7c565b6001600160a01b03165f9081526020819052604090205490565b6102317f000000000000000000000000000000000000000000000000000000000000000081565b61017a610721565b6101c26102d5366004610e1a565b610730565b61015f6102e8366004610ebf565b61073d565b61015f6102fb366004610ebf565b6108d1565b61015f60055481565b61015f610317366004610de8565b6109d2565b61015f61032a366004610e7c565b6109f6565b61015f61033d366004610e7c565b610a3d565b61015f610350366004610ef8565b6001600160a01b039182165f90815260016020908152604080832093909416825291909152205490565b61015f610388366004610de8565b610a5a565b6040516370a0823160e01b81523060048201525f907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316906370a0823190602401602060405180830381865afa1580156103f1573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906104159190610f20565b905090565b60606003805461042990610f37565b80601f016020809104026020016040519081016040528092919081815260200182805461045590610f37565b80156104a05780601f10610477576101008083540402835291602001916104a0565b820191905f5260205f20905b81548152906001019060200180831161048357829003601f168201915b5050505050905090565b5f815f036104b957505f919050565b670de0b6b3a7640000600554836104d09190610f83565b6104da9190610f9a565b92915050565b6127106104ed8282610fb9565b6005546104fa9190610f83565b6105049190610f9a565b60055550565b5f33610517818585610a64565b5060019392505050565b6005545f908190610533600182610fcc565b61054585670de0b6b3a7640000610f83565b61054f9190610fb9565b6105599190610f9a565b9392505050565b5f3361056d858285610a76565b610578858585610af2565b506001949350505050565b5f5f83116105c65760405162461bcd60e51b815260206004820152600b60248201526a5a65726f2061737365747360a81b60448201526064015b60405180910390fd5b6001600160a01b0382166105ec5760405162461bcd60e51b81526004016105bd90610fdf565b6105f5836109d2565b90505f811161063f5760405162461bcd60e51b815260206004820152601660248201527516995c9bc81cda185c995cc818d85b18dd5b185d195960521b60448201526064016105bd565b6040516323b872dd60e01b8152336004820152306024820152604481018490527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316906323b872dd906064016020604051808303815f875af11580156106af573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906106d39190611009565b6107175760405162461bcd60e51b8152602060048201526015602482015274105cdcd95d081d1c985b9cd9995c8819985a5b1959605a1b60448201526064016105bd565b6104da8282610b4f565b60606004805461042990610f37565b5f33610517818585610af2565b5f5f841161077b5760405162461bcd60e51b815260206004820152600b60248201526a5a65726f2061737365747360a81b60448201526064016105bd565b6001600160a01b0383166107a15760405162461bcd60e51b81526004016105bd90610fdf565b6005546107af600182610fcc565b6107c186670de0b6b3a7640000610f83565b6107cb9190610fb9565b6107d59190610f9a565b9050336001600160a01b038316146107f2576107f2823383610a76565b6107fc8282610b87565b60405163a9059cbb60e01b81526001600160a01b038481166004830152602482018690527f0000000000000000000000000000000000000000000000000000000000000000169063a9059cbb906044015b6020604051808303815f875af1158015610869573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061088d9190611009565b6105595760405162461bcd60e51b8152602060048201526015602482015274105cdcd95d081d1c985b9cd9995c8819985a5b1959605a1b60448201526064016105bd565b5f5f841161090f5760405162461bcd60e51b815260206004820152600b60248201526a5a65726f2073686172657360a81b60448201526064016105bd565b6001600160a01b0383166109355760405162461bcd60e51b81526004016105bd90610fdf565b670de0b6b3a76400006005548561094c9190610f83565b6109569190610f9a565b9050336001600160a01b0383161461097357610973823386610a76565b61097d8285610b87565b60405163a9059cbb60e01b81526001600160a01b038481166004830152602482018390527f0000000000000000000000000000000000000000000000000000000000000000169063a9059cbb9060440161084d565b5f815f036109e157505f919050565b6005546104d083670de0b6b3a7640000610f83565b5f5f610a19610195846001600160a01b03165f9081526020819052604090205490565b90505f610a2461038d565b9050808210610a335780610a35565b815b949350505050565b6001600160a01b0381165f908152602081905260408120546104da565b5f6104da826109d2565b610a718383836001610bbb565b505050565b6001600160a01b038381165f908152600160209081526040808320938616835292905220545f19811015610aec5781811015610ade57604051637dc7a0d960e11b81526001600160a01b038416600482015260248101829052604481018390526064016105bd565b610aec84848484035f610bbb565b50505050565b6001600160a01b038316610b1b57604051634b637e8f60e11b81525f60048201526024016105bd565b6001600160a01b038216610b445760405163ec442f0560e01b81525f60048201526024016105bd565b610a71838383610c8d565b6001600160a01b038216610b785760405163ec442f0560e01b81525f60048201526024016105bd565b610b835f8383610c8d565b5050565b6001600160a01b038216610bb057604051634b637e8f60e11b81525f60048201526024016105bd565b610b83825f83610c8d565b6001600160a01b038416610be45760405163e602df0560e01b81525f60048201526024016105bd565b6001600160a01b038316610c0d57604051634a1406b160e11b81525f60048201526024016105bd565b6001600160a01b038085165f9081526001602090815260408083209387168352929052208290558015610aec57826001600160a01b0316846001600160a01b03167f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92584604051610c7f91815260200190565b60405180910390a350505050565b6001600160a01b038316610cb7578060025f828254610cac9190610fb9565b90915550610d279050565b6001600160a01b0383165f9081526020819052604090205481811015610d095760405163391434e360e21b81526001600160a01b038516600482015260248101829052604481018390526064016105bd565b6001600160a01b0384165f9081526020819052604090209082900390555b6001600160a01b038216610d4357600280548290039055610d61565b6001600160a01b0382165f9081526020819052604090208054820190555b816001600160a01b0316836001600160a01b03167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef83604051610da691815260200190565b60405180910390a3505050565b602081525f82518060208401528060208501604085015e5f604082850101526040601f19601f83011684010191505092915050565b5f60208284031215610df8575f5ffd5b5035919050565b80356001600160a01b0381168114610e15575f5ffd5b919050565b5f5f60408385031215610e2b575f5ffd5b610e3483610dff565b946020939093013593505050565b5f5f5f60608486031215610e54575f5ffd5b610e5d84610dff565b9250610e6b60208501610dff565b929592945050506040919091013590565b5f60208284031215610e8c575f5ffd5b61055982610dff565b5f5f60408385031215610ea6575f5ffd5b82359150610eb660208401610dff565b90509250929050565b5f5f5f60608486031215610ed1575f5ffd5b83359250610ee160208501610dff565b9150610eef60408501610dff565b90509250925092565b5f5f60408385031215610f09575f5ffd5b610f1283610dff565b9150610eb660208401610dff565b5f60208284031215610f30575f5ffd5b5051919050565b600181811c90821680610f4b57607f821691505b602082108103610f6957634e487b7160e01b5f52602260045260245ffd5b50919050565b634e487b7160e01b5f52601160045260245ffd5b80820281158282048414176104da576104da610f6f565b5f82610fb457634e487b7160e01b5f52601260045260245ffd5b500490565b808201808211156104da576104da610f6f565b818103818111156104da576104da610f6f565b60208082526010908201526f24b73b30b634b2103932b1b2b4bb32b960811b604082015260600190565b5f60208284031215611019575f5ffd5b81518015158114610559575f5ffdfea2646970667358221220c2a621f656f90b49f3785be74d061f5f1a4e2e9c73c33375c507e1d000eb667064736f6c63430008250033" as const;
