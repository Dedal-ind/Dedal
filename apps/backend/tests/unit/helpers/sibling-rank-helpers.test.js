import { describe, it, expect } from "vitest";
import {
  RANK_ALPHABET,
  normaliseRank,
  rankBetween,
  rankBefore,
  rankAfter,
  evenlySpacedRanks,
  compareRanks,
} from "../../../src/helpers/sibling-rank-helpers.js";

const FIRST = RANK_ALPHABET[0];
const LAST = RANK_ALPHABET[RANK_ALPHABET.length - 1];

function isSorted(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

describe("sibling-rank-helpers", () => {
  it("uses an alphabet whose character order is its ASCII order", () => {
    expect(isSorted(Array.from(RANK_ALPHABET))).toBe(true);
    expect(RANK_ALPHABET).toHaveLength(62);
  });

  describe("normaliseRank", () => {
    it("treats empty, non-string and malformed ranks as absent", () => {
      expect(normaliseRank(null)).toBeNull();
      expect(normaliseRank(undefined)).toBeNull();
      expect(normaliseRank("")).toBeNull();
      expect(normaliseRank(3)).toBeNull();
      expect(normaliseRank("U-V")).toBeNull();
      expect(normaliseRank("Ü")).toBeNull();
    });

    it("strips trailing minimum characters and keeps everything else", () => {
      expect(normaliseRank("U")).toBe("U");
      expect(normaliseRank(`U${FIRST}${FIRST}`)).toBe("U");
      expect(normaliseRank(FIRST)).toBeNull();
      expect(normaliseRank(`${FIRST}V`)).toBe(`${FIRST}V`);
    });
  });

  describe("rankBetween", () => {
    it("mints a first rank for an empty level", () => {
      const rank = rankBetween(null, null);
      expect(rank).toBe("V");
    });

    it("mints before a first sibling and after a last sibling", () => {
      expect(rankBefore("V") < "V").toBe(true);
      expect(rankAfter("V") > "V").toBe(true);
      expect(rankBefore("V")).toBe(rankBetween(null, "V"));
      expect(rankAfter("V")).toBe(rankBetween("V", null));
    });

    it("mints strictly between two ranks with room", () => {
      const rank = rankBetween("A", "Z");
      expect(rank > "A" && rank < "Z").toBe(true);
      expect(rank).toHaveLength(1);
    });

    it("extends by a character rather than failing when the neighbours are adjacent", () => {
      const rank = rankBetween("U", "V");
      expect(rank > "U" && rank < "V").toBe(true);
      expect(rank.startsWith("U")).toBe(true);
      expect(rank).toHaveLength(2);
    });

    it("keeps going past the top and bottom of the alphabet", () => {
      const beyondLast = rankAfter(LAST);
      expect(beyondLast > LAST).toBe(true);
      const beforeFirstPossible = rankBefore(`${FIRST}1`);
      expect(beforeFirstPossible < `${FIRST}1`).toBe(true);
      expect(beforeFirstPossible.endsWith(FIRST)).toBe(false);
    });

    it("never produces a rank ending in the minimum character", () => {
      let lower = null;
      let upper = "1";
      for (let round = 0; round < 40; round += 1) {
        const rank = rankBetween(lower, upper);
        expect(rank.endsWith(FIRST)).toBe(false);
        upper = rank;
      }
      lower = "1";
      upper = "2";
      for (let round = 0; round < 40; round += 1) {
        const rank = rankBetween(lower, upper);
        expect(rank.endsWith(FIRST)).toBe(false);
        lower = rank;
      }
    });

    it("treats a malformed bound as absent", () => {
      expect(rankBetween("!!", "V")).toBe(rankBetween(null, "V"));
      expect(rankBetween("V", "")).toBe(rankBetween("V", null));
    });

    it("refuses bounds that do not ascend", () => {
      expect(() => rankBetween("V", "U")).toThrow(/not ascending/);
      expect(() => rankBetween("V", "V")).toThrow(/not ascending/);
      expect(() => rankBetween("V", `V${FIRST}`)).toThrow(/not ascending/);
    });

    it("stays ordered across a long chain of drops into the same gap", () => {
      const ranks = ["A", "B"];
      for (let round = 0; round < 200; round += 1) {
        // Always drop between the first two, the tightest possible gap.
        ranks.splice(1, 0, rankBetween(ranks[0], ranks[1]));
        expect(isSorted(ranks)).toBe(true);
      }
    });
  });

  describe("evenlySpacedRanks", () => {
    it("returns ordered, short, well-formed ranks", () => {
      for (const count of [0, 1, 2, 30, 61, 62, 200, 5000]) {
        const ranks = evenlySpacedRanks(count);
        expect(ranks).toHaveLength(count);
        expect(isSorted(ranks)).toBe(true);
        expect(new Set(ranks).size).toBe(count);
        for (const rank of ranks) {
          expect(normaliseRank(rank)).toBe(rank);
        }
      }
      expect(evenlySpacedRanks(30).every((rank) => rank.length === 1)).toBe(true);
      expect(evenlySpacedRanks(200).every((rank) => rank.length <= 2)).toBe(true);
    });

    it("leaves room to drop between any two neighbours without extending", () => {
      const ranks = evenlySpacedRanks(30);
      for (let index = 1; index < ranks.length; index += 1) {
        expect(rankBetween(ranks[index - 1], ranks[index])).toHaveLength(1);
      }
    });
  });

  describe("compareRanks", () => {
    it("sorts absent first, then by string order", () => {
      const sorted = ["V", null, "A", "", "AA"].sort(compareRanks);
      expect(sorted).toEqual([null, "", "A", "AA", "V"]);
    });
  });
});
