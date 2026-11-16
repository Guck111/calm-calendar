# Calm Calendar

## Language

- Code comments, test names (`describe` / `it` / `test`), log and error messages for developers, and commit messages are in English.
- Russian (and Ukrainian, Belarusian) appears only in user-facing data:
  - UI dictionaries in `src/shared/i18n/*.ts` and `src-tauri/src/i18n.rs`;
  - quick-add parser word lists and patterns in `src/shared/lib/quick-*.ts`;
  - test inputs and expected values that exercise those locales and parsers, and the Russian demo data in `src/shared/api/mock.ts`.
