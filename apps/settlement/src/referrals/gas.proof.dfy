lemma actualWei_ensures(gasUsed: int, effectiveGasPrice: int, i_gasLimit: int, i_maxFeePerGas: int)
  requires (gasUsed >= 0)
  requires (effectiveGasPrice >= 0)
  requires (i_gasLimit >= 0)
  requires (i_maxFeePerGas >= 0)
  ensures ((gasUsed <= i_gasLimit) ==> (effectiveGasPrice <= i_maxFeePerGas) ==> (actualWei(gasUsed, effectiveGasPrice, i_gasLimit, i_maxFeePerGas) <= (i_gasLimit * i_maxFeePerGas)))
  ensures (actualWei(gasUsed, effectiveGasPrice, i_gasLimit, i_maxFeePerGas) == (gasUsed * effectiveGasPrice))
{
  if gasUsed <= i_gasLimit && effectiveGasPrice <= i_maxFeePerGas {
    assert (i_gasLimit - gasUsed) * effectiveGasPrice >= 0;
    assert gasUsed * effectiveGasPrice <= i_gasLimit * effectiveGasPrice;
    assert i_gasLimit * (i_maxFeePerGas - effectiveGasPrice) >= 0;
    assert i_gasLimit * effectiveGasPrice <= i_gasLimit * i_maxFeePerGas;
  }
}
