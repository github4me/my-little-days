Pod::Spec.new do |s|
  s.name = 'FamilyStorageSecurity'
  s.version = '1.0.0'
  s.summary = 'On-device database backup exclusion for My Little Days'
  s.description = 'Protects the persistent SQLite directory before family data is opened.'
  s.author = 'My Little Days'
  s.homepage = 'https://github.com/github4me/my-little-days'
  s.license = '0BSD'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => 'https://github.com/github4me/my-little-days.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
