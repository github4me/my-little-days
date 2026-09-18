Pod::Spec.new do |s|
  s.name = 'LittleDaysWatchBridge'
  s.version = '1.0.0'
  s.summary = 'Durable paired Apple Watch transport for My Little Days'
  s.description = 'Persists Watch commands before transport acknowledgement without granting family access.'
  s.author = 'My Little Days'
  s.homepage = 'https://github.com/github4me/my-little-days'
  s.license = '0BSD'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => 'https://github.com/github4me/my-little-days.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity', 'CryptoKit', 'WidgetKit'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
