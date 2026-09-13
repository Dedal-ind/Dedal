// check-in-stats.js
// The four check-in numbers every staff screen shows, in one order, with one set
// of words and the CSV kind each one downloads.
//
// Both the coordinator event screen and the volunteer checkpoint screen call
// this. The download kinds are the backend's CSV route segments, identical under
// /backstage/coordinator/events/:eventId/ and
// /backstage/volunteer/checkpoints/:checkpointId/, so the same list names work
// for both — the screen supplies only the base path.

export function buildCheckInStats({ checkedIn, yetToArrive, total, checkedOut }) {
  return [
    { key: 'checked-in', label: 'Checked in', value: checkedIn, download: 'checked-in' },
    { key: 'yet', label: 'Yet to arrive', value: yetToArrive, download: 'yet-to-checkin' },
    { key: 'total', label: 'Registered', value: total, download: 'participants' },
    { key: 'out', label: 'Checked out', value: checkedOut, download: 'checked-out' },
  ];
}
