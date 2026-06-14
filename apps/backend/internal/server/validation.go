package server

import (
	"errors"
	"strings"

	"connectrpc.com/connect"
)

func invalidArg(msg string) error {
	return connect.NewError(connect.CodeInvalidArgument, errors.New(msg))
}

func requireNonEmpty(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return invalidArg(field + " must not be empty")
	}
	return nil
}

func requireMagnet(uri string) error {
	if err := requireNonEmpty("magnet_uri", uri); err != nil {
		return err
	}
	if !strings.HasPrefix(uri, "magnet:?") {
		return invalidArg("magnet_uri must start with magnet:?")
	}
	return nil
}
