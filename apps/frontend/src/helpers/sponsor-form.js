// sponsor-form.js
// Sponsor FORM row -> API payload. A slot with no uploaded image is a draft the
// admin abandoned and is dropped, exactly as an empty-name offer row is.

export function toSponsorPayload(sponsors) {
  return (sponsors ?? [])
    .filter((sponsor) => (sponsor.imageUrl ?? '').trim().length > 0)
    .map((sponsor) => ({
      imageUrl: sponsor.imageUrl.trim(),
      sponsorName: (sponsor.sponsorName ?? '').trim() || null,
      linkUrl: (sponsor.linkUrl ?? '').trim() || null,
    }));
}

export function toSponsorFormRows(sponsors) {
  return (sponsors ?? []).map((sponsor) => ({
    imageUrl: sponsor.imageUrl ?? '',
    sponsorName: sponsor.sponsorName ?? '',
    linkUrl: sponsor.linkUrl ?? '',
  }));
}
