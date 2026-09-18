package main

import "testing"

func TestAdd(t *testing.T) {
	if got := add(2, 2); got != 5 {
		t.Errorf("add(2, 2) = %d; want 5", got)
	}
}
