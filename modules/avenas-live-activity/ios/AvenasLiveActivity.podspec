Pod::Spec.new do |s|
  s.name           = 'AvenasLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Workout Live Activity bridge for Avenas'
  s.description    = 'Starts, updates and ends the Avenas workout Live Activity and relays lock-screen set ticks and rest-timer actions back to JS.'
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
