export function toMinor(majorAmount: number): number {
    return Math.round(majorAmount * 100);
}

export function fromMinor(minorAmount: number): number {
    return minorAmount / 100;
}

export function sumMinor(amounts: number[]): number {
    return amounts.reduce((acc, n) => acc + n, 0);
}

export function multiplyMinor(unitPriceMinor: number, quantity: number): number {
    return unitPriceMinor * quantity;
}
