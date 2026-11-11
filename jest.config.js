/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  cacheDirectory: '<rootDir>/.jest-cache',
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts']
};
