// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Harmless local Anvil assets and router. These contracts are never deployed by
// a release. The fixed exchange rate isolates approval and journal recovery
// from public liquidity/provider availability.
contract FeeConverterToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function decimals() external pure virtual returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        move(from, to, amount);
        return true;
    }

    function move(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract FeeConverterUSDC is FeeConverterToken {
    function decimals() external pure override returns (uint8) {
        return 6;
    }
}

contract FeeConverterRouter {
    struct Description {
        address srcToken;
        address dstToken;
        address[] srcReceivers;
        uint256[] srcAmounts;
        address[] feeReceivers;
        uint256[] feeAmounts;
        address dstReceiver;
        uint256 amount;
        uint256 minReturnAmount;
        uint256 flags;
        bytes permit;
    }

    function swapSimpleMode(address, Description calldata desc, bytes calldata, bytes calldata)
        external
        payable
        returns (uint256 returnAmount, uint256 gasUsed)
    {
        bool nativeAsset = desc.srcToken == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
        returnAmount = desc.amount / (nativeAsset ? 1e9 : 2e12);
        require(returnAmount >= desc.minReturnAmount, "minimum");
        if (nativeAsset) {
            require(msg.value == desc.amount, "native input");
        } else {
            require(msg.value == 0, "token input");
            require(FeeConverterToken(desc.srcToken).transferFrom(msg.sender, address(this), desc.amount));
        }
        require(FeeConverterToken(desc.dstToken).transfer(desc.dstReceiver, returnAmount));
        gasUsed = 100000;
    }
}

contract FeeConverterL1Oracle {
    function getL1FeeUpperBound(uint256) external pure returns (uint256) {
        return 0;
    }

    function getOperatorFee(uint256) external pure returns (uint256) {
        return 0;
    }

    function getL1Fee(bytes calldata) external pure returns (uint256) {
        return 0;
    }
}
