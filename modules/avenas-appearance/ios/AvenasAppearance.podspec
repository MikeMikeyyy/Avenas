Pod::Spec.new do |s|
  s.name           = 'AvenasAppearance'
  s.version        = '1.0.0'
  s.summary        = "The app's Dark Mode for the launch splash"
  s.description    = "Keeps the app's own Dark Mode where launch code can read it, and turns the splash dark at launch for someone who uses it."
  s.author         = 'Avenas'
  s.homepage       = 'https://avenas.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.license        = { :type => 'MIT' }

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
