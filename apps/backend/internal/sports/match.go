package sports

import (
	"strings"
	"unicode"
)

var accentFold = strings.NewReplacer(
	"á", "a", "à", "a", "â", "a", "ä", "a", "ã", "a",
	"é", "e", "è", "e", "ê", "e", "ë", "e",
	"í", "i", "ì", "i", "î", "i", "ï", "i",
	"ó", "o", "ò", "o", "ô", "o", "ö", "o", "õ", "o",
	"ú", "u", "ù", "u", "û", "u", "ü", "u",
	"ñ", "n", "ç", "c",
)

// Club-form noise that differs between data sources ("Arsenal FC" vs "Arsenal").
var noiseTokens = map[string]bool{
	"fc": true, "cf": true, "afc": true, "sc": true, "cd": true, "ud": true,
	"rcd": true, "rc": true, "sd": true, "club": true, "de": true, "the": true,
	"vs": true, "v": true,
}

// normalize lowercases, folds accents, turns punctuation into spaces and drops
// club-form tokens, returning " tok1 tok2 " (space-padded for whole-word Contains).
func normalize(s string) string {
	s = accentFold.Replace(strings.ToLower(s))
	fields := strings.FieldsFunc(s, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	kept := fields[:0]
	for _, f := range fields {
		if !noiseTokens[f] {
			kept = append(kept, f)
		}
	}
	return " " + strings.Join(kept, " ") + " "
}

// mentions reports whether event mentions any of the team's names as whole words.
func mentions(event string, names []string) bool {
	for _, n := range names {
		if k := normalize(n); strings.TrimSpace(k) != "" && strings.Contains(event, k) {
			return true
		}
	}
	return false
}

// findEvent picks the first catalog event naming both teams.
// ponytail: name matching only; aliases like "Spurs" for Tottenham miss —
// add an alias map if a source uses nicknames.
func findEvent(events []addonMeta, home, away []string) (addonMeta, bool) {
	for _, e := range events {
		n := normalize(e.Name)
		if mentions(n, home) && mentions(n, away) {
			return e, true
		}
	}
	return addonMeta{}, false
}
