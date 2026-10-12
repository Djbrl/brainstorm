// pairingOf pairs only the new steps of a growing thread; it must pair exactly as pairResults does on the whole list.
import { describe, expect, it } from "vitest";
import { pairingOf, pairResults } from "./format";
import { randomSteps, rng } from "../test/fixtures";

describe("pairingOf", () => {
  it("grows to what pairing the whole list gives", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const all = randomSteps(rng(seed), `P${seed % 7}`); // threads share ids now and then: a list that isn't a growth starts over
      for (let n = 1; n <= all.length; n += 1 + (seed % 3)) {
        const list = all.slice(0, n), whole = pairResults(list), p = pairingOf(list);
        expect(new Map([...p.resultOf])).toEqual(new Map([...whole].map(([call, r]) => [call, r.id])));
        expect(new Map([...p.callOf])).toEqual(new Map([...whole].map(([call, r]) => [r.id, call])));
      }
    }
  });
  it("starts over when the list isn't the last one grown", () => {
    const a = randomSteps(rng(1), "Q"), b = randomSteps(rng(2), "Q");
    pairingOf(a);
    expect(new Map([...pairingOf(b).resultOf])).toEqual(new Map([...pairResults(b)].map(([c, r]) => [c, r.id])));
  });
});
