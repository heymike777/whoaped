#!/usr/bin/env ruby

require 'base64'
require 'fileutils'
require 'json'
require 'net/http'
require 'openssl'
require 'time'
require 'uri'

class AppleConnect
  BASE_URL = 'https://api.appstoreconnect.apple.com'

  def initialize(key_id:, issuer_id:, key_path:)
    @key_id = key_id
    @issuer_id = issuer_id
    @private_key = OpenSSL::PKey.read(File.read(key_path))
  end

  def request(method, path, body: nil)
    uri = URI.join(BASE_URL, path)
    request = Net::HTTP.const_get(method.capitalize).new(uri)
    request['Authorization'] = "Bearer #{token}"
    request['Content-Type'] = 'application/json'
    request.body = JSON.generate(body) if body

    response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|
      http.request(request)
    end
    parsed = response.body.empty? ? {} : JSON.parse(response.body)
    return parsed if response.code.to_i.between?(200, 299)

    errors = Array(parsed['errors']).map do |error|
      [error['status'], error['code'], error['title'], error['detail']].compact.join(' · ')
    end
    raise "Apple API #{method.upcase} #{path} failed: #{errors.join('; ')}"
  end

  private

  def token
    now = Time.now.to_i
    header = encode(alg: 'ES256', kid: @key_id, typ: 'JWT')
    payload = encode(iss: @issuer_id, iat: now, exp: now + 1_100, aud: 'appstoreconnect-v1')
    input = "#{header}.#{payload}"
    der_signature = @private_key.sign(OpenSSL::Digest::SHA256.new, input)
    sequence = OpenSSL::ASN1.decode(der_signature)
    raw_signature = sequence.value.map { |integer| integer.value.to_s(2).rjust(32, "\0") }.join
    "#{input}.#{Base64.urlsafe_encode64(raw_signature, padding: false)}"
  end

  def encode(value)
    Base64.urlsafe_encode64(JSON.generate(value), padding: false)
  end
end

def query(path, params)
  "#{path}?#{URI.encode_www_form(params)}"
end

key_id = ENV.fetch('ASC_KEY_ID')
issuer_id = ENV.fetch('ASC_ISSUER_ID')
key_path = ENV.fetch('ASC_KEY_PATH')
bundle_identifier = ENV.fetch('BUNDLE_ID', 'com.whoaped.app')
client = AppleConnect.new(key_id: key_id, issuer_id: issuer_id, key_path: key_path)

bundle_response = client.request(
  'get',
  query('/v1/bundleIds', 'filter[identifier]' => bundle_identifier, 'include' => 'bundleIdCapabilities'),
)
bundle = bundle_response.fetch('data').first

case ARGV.fetch(0, 'inspect')
when 'inspect'
  app_response = client.request('get', query('/v1/apps', 'filter[bundleId]' => bundle_identifier))
  certificate_response = client.request(
    'get',
    query('/v1/certificates', 'filter[certificateType]' => 'IOS_DISTRIBUTION', 'limit' => '10'),
  )
  puts JSON.pretty_generate(
    bundle_id: bundle&.dig('attributes', 'identifier'),
    capabilities: Array(bundle_response['included']).map { |item| item.dig('attributes', 'capabilityType') },
    app: app_response.fetch('data').first&.dig('attributes')&.slice('name', 'bundleId', 'sku'),
    distribution_certificates: certificate_response.fetch('data').map do |item|
      item.fetch('attributes').slice('name', 'displayName', 'expirationDate')
    end,
  )
when 'ensure_bundle'
  unless bundle
    response = client.request(
      'post',
      '/v1/bundleIds',
      body: {
        data: {
          type: 'bundleIds',
          attributes: {
            identifier: bundle_identifier,
            name: 'WhoAped',
            platform: 'IOS',
          },
        },
      },
    )
    bundle = response.fetch('data')
    puts "Created bundle ID #{bundle_identifier}"
  else
    puts "Bundle ID #{bundle_identifier} already exists"
  end

  capabilities = client.request('get', "/v1/bundleIds/#{bundle.fetch('id')}/bundleIdCapabilities")
  push = capabilities.fetch('data').find do |item|
    item.dig('attributes', 'capabilityType') == 'PUSH_NOTIFICATIONS'
  end
  unless push
    client.request(
      'post',
      '/v1/bundleIdCapabilities',
      body: {
        data: {
          type: 'bundleIdCapabilities',
          attributes: { capabilityType: 'PUSH_NOTIFICATIONS' },
          relationships: {
            bundleId: { data: { type: 'bundleIds', id: bundle.fetch('id') } },
          },
        },
      },
    )
    puts 'Enabled Push Notifications'
  else
    puts 'Push Notifications already enabled'
  end
when 'ensure_profile'
  raise "Bundle ID #{bundle_identifier} does not exist" unless bundle

  profiles = client.request('get', "/v1/bundleIds/#{bundle.fetch('id')}/profiles").fetch('data')
  profile = profiles.find do |item|
    item.dig('attributes', 'profileType') == 'IOS_APP_STORE' &&
      item.dig('attributes', 'profileState') == 'ACTIVE'
  end

  unless profile
    certificates = client.request(
      'get',
      query('/v1/certificates', 'filter[certificateType]' => 'IOS_DISTRIBUTION', 'limit' => '10'),
    ).fetch('data')
    certificate = certificates.find do |item|
      item.dig('attributes', 'displayName') == 'Danger Valley' &&
        Time.parse(item.dig('attributes', 'expirationDate')) > Time.now
    end
    raise 'No active Danger Valley iOS distribution certificate found' unless certificate

    profile = client.request(
      'post',
      '/v1/profiles',
      body: {
        data: {
          type: 'profiles',
          attributes: { name: 'WhoAped App Store', profileType: 'IOS_APP_STORE' },
          relationships: {
            bundleId: { data: { type: 'bundleIds', id: bundle.fetch('id') } },
            certificates: { data: [{ type: 'certificates', id: certificate.fetch('id') }] },
          },
        },
      },
    ).fetch('data')
    puts 'Created WhoAped App Store provisioning profile'
  else
    profile = client.request('get', "/v1/profiles/#{profile.fetch('id')}").fetch('data')
    puts 'WhoAped App Store provisioning profile already exists'
  end

  attributes = profile.fetch('attributes')
  output_directory = ENV.fetch(
    'PROFILE_DIRECTORY',
    File.expand_path('~/Library/MobileDevice/Provisioning Profiles'),
  )
  FileUtils.mkdir_p(output_directory)
  output_path = File.join(output_directory, "#{attributes.fetch('uuid')}.mobileprovision")
  File.binwrite(output_path, Base64.decode64(attributes.fetch('profileContent')))
  puts JSON.generate(name: attributes.fetch('name'), uuid: attributes.fetch('uuid'), path: output_path)
else
  abort 'Usage: scripts/apple_connect.rb [inspect|ensure_bundle|ensure_profile]'
end
