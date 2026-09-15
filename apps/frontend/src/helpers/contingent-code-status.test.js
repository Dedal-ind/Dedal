/*
 * contingent-code-status.test.js
 *
 * A solo code is sent to one person; a team code to the whole team. The label,
 * the hint and the progress count are what tell the buyer which is which.
 */
import { describe, it, expect } from 'vitest';
import {
  SHARE_CODES_MESSAGE,
  describeCodeRefusal,
  describeContingentCode,
  formatCodesForSharing,
} from './contingent-code-status.js';

const SOLO = { code: 'A7X9K2PQ', eventName: 'Agora Debate', eventType: 'solo', maxUses: 1, claims: [] };
const TEAM = { code: 'B3M8N1RT', eventName: 'Cricket Men', eventType: 'team', maxUses: 5, claims: [] };

describe('describeContingentCode — solo', () => {
  it('labels an unused solo code as available, for one person', () => {
    expect(describeContingentCode(SOLO)).toMatchObject({
      isTeam: false,
      label: 'Agora Debate',
      hint: 'Give this code to one person',
      statusText: 'Available',
      canCopy: true,
      roster: [],
      spotsText: null,
    });
  });

  it('names who claimed a used solo code, and stops offering the copy', () => {
    const claimed = { ...SOLO, claimCount: 1, isFull: true, claims: [{ userId: 'u1', fullName: 'Asha Rao' }] };
    expect(describeContingentCode(claimed)).toMatchObject({
      statusText: 'Claimed by Asha Rao',
      tone: 'done',
      canCopy: false,
    });
  });

  it('marks an expired code', () => {
    expect(describeContingentCode({ ...SOLO, isExpired: true, isRedeemable: false })).toMatchObject({
      statusText: 'Expired',
      canCopy: false,
    });
  });
});

describe('describeContingentCode — team', () => {
  it('labels a team code with its size and asks for it to go to every member', () => {
    expect(describeContingentCode(TEAM)).toMatchObject({
      isTeam: true,
      label: 'Cricket Men (Team of 5)',
      hint: 'Share this code with all 5 team members',
      statusText: '0 of 5 joined',
      spotsText: '5 spots remaining',
      canCopy: true,
    });
  });

  it('counts joins and lists the roster with the captain marked', () => {
    const partial = {
      ...TEAM,
      claimCount: 3,
      claims: [
        { userId: 'u1', fullName: 'Asha', isCaptain: true },
        { userId: 'u2', fullName: 'Ravi' },
        { userId: 'u3', fullName: '' },
      ],
    };
    const described = describeContingentCode(partial);
    expect(described.statusText).toBe('3 of 5 joined');
    expect(described.spotsText).toBe('2 spots remaining');
    expect(described.roster).toEqual([
      { key: 'u1', name: 'Asha', isCaptain: true },
      { key: 'u2', name: 'Ravi', isCaptain: false },
      { key: 'u3', name: 'A participant', isCaptain: false },
    ]);
  });

  it('says the team is complete once every place is taken', () => {
    const full = { ...TEAM, claimCount: 5, isFull: true, claims: Array.from({ length: 5 }, (_, i) => ({ userId: `u${i}`, fullName: `M${i}` })) };
    expect(describeContingentCode(full)).toMatchObject({
      statusText: 'Full — team complete',
      spotsText: null,
      canCopy: false,
    });
  });

  it('reads a single remaining place in the singular', () => {
    expect(describeContingentCode({ ...TEAM, claimCount: 4 }).spotsText).toBe('1 spot remaining');
  });
});

describe('formatCodesForSharing', () => {
  it('lists every code with its event label and ends with how to use them', () => {
    const text = formatCodesForSharing([SOLO, TEAM], 'Chaturanga — Alliance ONE');
    expect(text).toBe(
      [
        'Chaturanga — Alliance ONE',
        '',
        'Agora Debate — CODE: A7X9K2PQ',
        'Cricket Men (Team of 5) — CODE: B3M8N1RT',
        '',
        SHARE_CODES_MESSAGE,
      ].join('\n'),
    );
  });
});

describe('describeCodeRefusal', () => {
  it('gives each refusal its own plain sentence', () => {
    expect(describeCodeRefusal('INVITE_CODE_NOT_FOUND')).toBe('Invalid code — check and try again');
    expect(describeCodeRefusal('CONTINGENT_CODE_FULLY_CLAIMED')).toBe('This code has already been used');
    expect(describeCodeRefusal('CONTINGENT_CODE_EXPIRED')).toBe('This code has expired');
    expect(describeCodeRefusal('EVENT_FULL')).toBe(
      'This event is full — your code is still valid if a slot opens',
    );
    expect(describeCodeRefusal('SOMETHING_ELSE', 'Fallback')).toBe('Fallback');
  });
});
