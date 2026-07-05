declare module "bn.js" {
  const BN: new (v: string | number) => {
    gt(other: unknown): boolean;
    toString(): string;
  };
  export default BN;
}
