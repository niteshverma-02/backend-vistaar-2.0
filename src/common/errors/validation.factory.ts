import type { HttpException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

import { badRequest } from './api-error';

/**
 * Turns class-validator's errors into the one v2 error shape.
 *
 * Without this the global `ValidationPipe` throws Nest's own
 * `BadRequestException`, whose body carries `error: "Bad Request"` — so a
 * malformed payload came back as `error.code: "BAD_REQUEST"` while
 * the API contract promises **`VALIDATION_FAILED`**. The app's
 * screens branch on that value to say what went wrong, and a second name for
 * the same condition is a branch nobody wrote.
 *
 * `details` is one plain sentence per bad value, because the app shows
 * `details[0]` to the partner as is. class-validator's own wording
 * (`raw_data.crops.0.area must not be less than 0`) is for developers, so it
 * is rewritten here with a readable name for the field — and which row of a
 * list it was, the useful half when a form has many.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): HttpException {
  return badRequest(
    'VALIDATION_FAILED',
    'Some details are missing or not correct. Please check and try again.',
    flatten(errors, []),
  );
}

function flatten(errors: ValidationError[], parent: string[]): string[] {
  return errors.flatMap((error) => {
    const path = [...parent, error.property];
    return [
      ...Object.entries(error.constraints ?? {}).map(([rule, message]) =>
        sentence(rule, message, error.property, path),
      ),
      ...flatten(error.children ?? [], path),
    ];
  });
}

/**
 * A DTO's own `message:` is already written for people and is kept; only
 * class-validator's defaults, which open with the property name, are
 * rewritten.
 */
function sentence(
  rule: string,
  message: string,
  property: string,
  path: string[],
): string {
  const field = label(path);
  if (rule === 'whitelistValidation') {
    // Only an outdated app or a typo in a client sends this; there is
    // nothing for the person to fix but to say what was refused.
    return `${field} is not accepted here.`;
  }
  if (!message.startsWith(property)) return message;

  const rest = message.slice(property.length).trim();
  const number = /(-?\d+(?:\.\d+)?)/.exec(rest)?.[1];
  switch (rule) {
    case 'isNotEmpty':
    case 'isDefined':
    case 'arrayNotEmpty':
      return `${field} is required.`;
    case 'isString':
    case 'isObject':
    case 'isArray':
    case 'isUuid':
    case 'matches':
    case 'isIn':
      return rule === 'isIn' && rest.includes(':')
        ? `${field} must be one of: ${rest.slice(rest.indexOf(':') + 1).trim()}.`
        : `${field} is not valid.`;
    case 'isInt':
      return `${field} must be a whole number.`;
    case 'isNumber':
      return `${field} must be a number.`;
    case 'isBoolean':
      return `${field} must be yes or no.`;
    case 'isDateString':
    case 'isDate':
      return `${field} must be a valid date, for example 2026-10-13.`;
    case 'isEmail':
      return `${field} must be a valid email address.`;
    case 'isUrl':
      return `${field} must be a valid web link.`;
    case 'min':
      return `${field} must be at least ${number}.`;
    case 'max':
      return `${field} must be at most ${number}.`;
    case 'minLength':
      return `${field} must be at least ${number} characters.`;
    case 'maxLength':
      return `${field} must be at most ${number} characters.`;
    case 'arrayMinSize':
      return `${field} needs at least ${number} item${number === '1' ? '' : 's'}.`;
    case 'arrayMaxSize':
      return `${field} can have at most ${number} item${number === '1' ? '' : 's'}.`;
    default:
      return `${field} ${rest}`.replace(/\.?$/, '.');
  }
}

/** Words a partner would not say, swapped for the ones they would. */
const WORDS: Record<string, string> = {
  otp: 'OTP',
  id: 'ID',
  ids: 'IDs',
  url: 'link',
  sku: 'product pack',
  pii: 'customer',
  q: 'question',
  a: 'answer',
  en: 'English',
  hi: 'Hindi',
};

/**
 * `raw_data.crops.0.area` → `Area (crops, row 1)`, `title.en` → `Title (English)`.
 * The leaf names the field; the nearest list and a language key say which one.
 */
export function label(path: string[]): string {
  const words = (key: string): string =>
    key
      .split('_')
      .filter((part) => part !== 'raw' && part !== 'data')
      .map((part) => WORDS[part] ?? part)
      .join(' ');

  const named = path.filter((key) => !/^\d+$/.test(key));
  const language = ['en', 'hi'].includes(named.at(-1) ?? '')
    ? named.pop()
    : undefined;
  const leaf = words(named.at(-1) ?? 'value') || 'value';

  const notes: string[] = [];
  const rowAt = path.findLastIndex((key) => /^\d+$/.test(key));
  if (rowAt > 0) {
    const row = `row ${Number(path[rowAt]) + 1}`;
    // A bad row itself (`crops.0`) has no leaf of its own to name.
    notes.push(
      rowAt === path.length - 1 ? row : `${words(path[rowAt - 1])}, ${row}`,
    );
  }
  if (language) notes.push(WORDS[language]);

  const name = leaf.charAt(0).toUpperCase() + leaf.slice(1);
  return notes.length ? `${name} (${notes.join(', ')})` : name;
}
