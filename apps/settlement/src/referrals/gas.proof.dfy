lemma GasMulNonNeg(x: int, y: int)
  requires x >= 0 && y >= 0
  ensures x * y >= 0
  decreases x
{
  if x > 0 {
    GasMulNonNeg(x - 1, y);
  }
}

lemma actualWei_ensures(gasUsed: int, effectiveGasPrice: int, i_gasLimit: int, i_maxFeePerGas: int)
  requires (gasUsed >= 0)
  requires (effectiveGasPrice >= 0)
  requires (i_gasLimit >= 0)
  requires (i_maxFeePerGas >= 0)
  ensures ((gasUsed <= i_gasLimit) ==> (effectiveGasPrice <= i_maxFeePerGas) ==> (actualWei(gasUsed, effectiveGasPrice, i_gasLimit, i_maxFeePerGas) <= (i_gasLimit * i_maxFeePerGas)))
  ensures (actualWei(gasUsed, effectiveGasPrice, i_gasLimit, i_maxFeePerGas) == (gasUsed * effectiveGasPrice))
{
  if gasUsed <= i_gasLimit && effectiveGasPrice <= i_maxFeePerGas {
    GasMulNonNeg(i_gasLimit - gasUsed, effectiveGasPrice);
    assert (i_gasLimit - gasUsed) * effectiveGasPrice == i_gasLimit * effectiveGasPrice - gasUsed * effectiveGasPrice;
    assert gasUsed * effectiveGasPrice <= i_gasLimit * effectiveGasPrice;
    GasMulNonNeg(i_gasLimit, i_maxFeePerGas - effectiveGasPrice);
    assert i_gasLimit * (i_maxFeePerGas - effectiveGasPrice) == i_gasLimit * i_maxFeePerGas - i_gasLimit * effectiveGasPrice;
    assert i_gasLimit * effectiveGasPrice <= i_gasLimit * i_maxFeePerGas;
  }
}
