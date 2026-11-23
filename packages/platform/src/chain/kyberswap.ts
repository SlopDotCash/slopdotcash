// spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"
const description = {
  type: "tuple",
  name: "desc",
  components: [
    { type: "address", name: "srcToken" },
    { type: "address", name: "dstToken" },
    { type: "address[]", name: "srcReceivers" },
    { type: "uint256[]", name: "srcAmounts" },
    { type: "address[]", name: "feeReceivers" },
    { type: "uint256[]", name: "feeAmounts" },
    { type: "address", name: "dstReceiver" },
    { type: "uint256", name: "amount" },
    { type: "uint256", name: "minReturnAmount" },
    { type: "uint256", name: "flags" },
    { type: "bytes", name: "permit" },
  ],
} as const;
const outputs = [
  { type: "uint256", name: "returnAmount" },
  { type: "uint256", name: "gasUsed" },
] as const;

export const kyberRouterAbi = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        name: "execution",
        components: [
          { type: "address", name: "callTarget" },
          { type: "address", name: "approveTarget" },
          { type: "bytes", name: "targetData" },
          description,
          { type: "bytes", name: "clientData" },
        ],
      },
    ],
    outputs,
  },
  {
    type: "function",
    name: "swapSimpleMode",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "caller" },
      description,
      { type: "bytes", name: "executorData" },
      { type: "bytes", name: "clientData" },
    ],
    outputs,
  },
] as const;
