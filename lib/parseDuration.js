// Parses simple duration shorthand like "30s", "10m", "2h", "1d" into
// milliseconds. Pure function — no ctx dependency, unit-testable on its own.

const UNIT_MS = {
	s: 1000,
	m: 60 * 1000,
	h: 60 * 60 * 1000,
	d: 24 * 60 * 60 * 1000,
};

function parseDuration(input) {
	if (typeof input !== "string") return null;

	const match = input.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
	if (!match) return null;

	const amount = Number(match[1]);
	const unit = match[2].toLowerCase();

	if (!Number.isFinite(amount) || amount <= 0) return null;

	return amount * UNIT_MS[unit];
}

module.exports = { parseDuration };
