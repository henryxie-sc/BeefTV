package asset

import (
	"encoding/json"
	"testing"
)

func TestCanvasMediaReferencesIncludesUnselectedGalleryImages(t *testing.T) {
	refs, err := CanvasMediaReferences(json.RawMessage(`{"nodes":[{"type":"image","metadata":{"assetId":"a","storageKey":"resource:r1","imageOutputs":[{"assetId":"a","storageKey":"resource:r1"},{"assetId":"b","storageKey":"resource:r2"}]}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, ref := range refs {
		if ref.AssetID == "b" && ref.ResourceID == "r2" {
			found = true
		}
	}
	if !found {
		t.Fatalf("unselected image is unprotected: %v", refs)
	}
}
