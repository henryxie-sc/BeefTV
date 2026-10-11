package app

import "testing"

func TestAPIMartMidjourneyCapabilityValidation(t *testing.T) {
	input := canvasGenerationInput{}
	input.Config.BaseURL = "https://api.apimart.ai/v1"
	input.Config.InterfaceType = "openai-image"
	input.Config.Model = "midjourney"
	input.Config.Size = "16:9"
	input.Config.Quality = "0.25"
	input.Config.Count = "1"
	s := &Service{}
	if err := s.validateResolvedImageCapability(&input); err != nil {
		t.Fatal(err)
	}
	if input.ImageCapability.References.MaskSupported || input.ImageCapability.TransparentBackground.Supported {
		t.Fatal("generic image features leaked into MJ")
	}
	input.Config.Quality = "high"
	if err := s.validateResolvedImageCapability(&input); err == nil {
		t.Fatal("accepted generic quality")
	}
}
