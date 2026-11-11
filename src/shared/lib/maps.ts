// Место встречи по клику: адрес открывается в Google Картах в браузере. Без ключа API и без прав Google:
// это обычная ссылка поиска на картах. Если в поле «Место» уже ссылка, открываем её саму.

/** Ссылка для поля «Место»; null — открывать нечего */
export const placeLink = (location: string | undefined): string | null => {
  const place = location?.trim();
  if (!place) return null;
  if (/^https?:\/\/\S+$/i.test(place)) return place;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
};
