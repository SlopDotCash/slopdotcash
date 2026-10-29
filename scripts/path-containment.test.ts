import { expect, test } from "bun:test";
import { posix, win32 } from "node:path";
import { isInsideDirectory } from "./path-containment";

test("a Windows path below the root is inside it", () => {
  const root = "C:\\work\\slopdotcash";
  expect(isInsideDirectory(root, root, win32)).toBe(true);
  expect(isInsideDirectory(root, `${root}\\evidence`, win32)).toBe(true);
  expect(isInsideDirectory(root, `${root}\\..evidence`, win32)).toBe(true);
  expect(
    isInsideDirectory(root, "c:\\WORK\\slopdotcash\\evidence", win32),
  ).toBe(true);
  expect(isInsideDirectory(root, "C:\\work\\slopdotcash-other", win32)).toBe(
    false,
  );
  expect(isInsideDirectory(root, "C:\\work", win32)).toBe(false);
  expect(isInsideDirectory(root, "D:\\private\\evidence", win32)).toBe(false);
});

test("a POSIX path below the root is inside it", () => {
  const root = "/work/slopdotcash";
  expect(isInsideDirectory(root, root, posix)).toBe(true);
  expect(isInsideDirectory(root, `${root}/evidence`, posix)).toBe(true);
  expect(isInsideDirectory(root, `${root}/..evidence`, posix)).toBe(true);
  expect(isInsideDirectory(root, "/work/slopdotcash-other", posix)).toBe(false);
  expect(isInsideDirectory(root, "/work", posix)).toBe(false);
  expect(isInsideDirectory(root, "/private/evidence", posix)).toBe(false);
});
