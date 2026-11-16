// Meeting location on click: the address opens in Google Maps in the browser. No API key and no Google scopes:
// it's a regular maps search link. If the "Location" field is already a link, open it as is.

/** Link for the "Location" field; null — nothing to open */
export const placeLink = (location: string | undefined): string | null => {
  const place = location?.trim();
  if (!place) return null;
  if (/^https?:\/\/\S+$/i.test(place)) return place;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
};
