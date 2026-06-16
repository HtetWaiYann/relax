package metadata

const (
	imageBase    = "https://image.tmdb.org/t/p/"
	posterSize   = "w342"
	backdropSize = "w1280"
	profileSize  = "w185"
)

func posterURL(path string) string   { return imageURL(posterSize, path) }
func backdropURL(path string) string { return imageURL(backdropSize, path) }
func profileURL(path string) string  { return imageURL(profileSize, path) }

func imageURL(size, path string) string {
	if path == "" {
		return ""
	}
	return imageBase + size + path
}
