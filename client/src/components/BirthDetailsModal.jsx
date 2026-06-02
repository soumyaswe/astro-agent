import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/BirthDetailsModal.css';

export default function BirthDetailsModal({ userId, onClose, existingProfile }) {
  const [formData, setFormData] = useState({
    name: '',
    dateOfBirth: '',
    timeOfBirth: '',
    placeOfBirth: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Pre-populate if profile already exists
  useEffect(() => {
    if (existingProfile) {
      setFormData({
        name: existingProfile.name || '',
        dateOfBirth: existingProfile.date_of_birth
          ? existingProfile.date_of_birth.split('T')[0]
          : '',
        timeOfBirth: existingProfile.time_of_birth || '',
        placeOfBirth: existingProfile.place_of_birth || '',
      });
    }
  }, [existingProfile]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    //Geocode the place of birth
    let latitude = null;
    let longitude = null;
    let timezone = null;

    if (formData.placeOfBirth) {
      try {
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
            formData.placeOfBirth
          )}&count=1&format=json`
        );
        const geoData = await geoRes.json();

        if (!geoData.results || geoData.results.length === 0) {
          setError('Could not find that city. Please try adding a country name.');
          setIsSaving(false);
          return;
        }

        const place = geoData.results[0];
        latitude  = place.latitude;
        longitude = place.longitude;
        timezone  = place.timezone ?? null;
      } catch {
        setError('Geocoding failed. Check your connection and try again.');
        setIsSaving(false);
        return;
      }
    }

    //Upsert into user_profiles
    const record = {
      id: userId,
      name: formData.name,
      date_of_birth: formData.dateOfBirth
        ? new Date(formData.dateOfBirth).toISOString()
        : null,
      time_of_birth: formData.timeOfBirth || null,
      place_of_birth: formData.placeOfBirth || null,
      latitude,
      longitude,
      timezone,
    };

    const { error: supabaseError } = await supabase
      .from('user_profiles')
      .upsert(record, { onConflict: 'id' });

    setIsSaving(false);

    if (supabaseError) {
      setError(supabaseError.message);
    } else {
      onClose(record);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose(null)}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-icon">✦</div>
          <div>
            <h2 id="modal-title">Your Cosmic Profile</h2>
            <p className="modal-subtitle">
              Enter your birth details so AstroAgent can read your stars accurately. Latitude, longitude & timezone will be automatically calculated.
            </p>
          </div>
          <button className="modal-close" onClick={() => onClose(null)} aria-label="Close">
            ✕
          </button>
        </div>

        {error && (
          <div className="modal-error" role="alert">
            ⚠ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="modal-form">
          {/* Name */}
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input
              id="name"
              name="name"
              type="text"
              placeholder="e.g. Soumya Das"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </div>

          {/* Date & Time row */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="dateOfBirth">Date of Birth</label>
              <input
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                value={formData.dateOfBirth}
                onChange={handleChange}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="timeOfBirth">Time of Birth</label>
              <input
                id="timeOfBirth"
                name="timeOfBirth"
                type="time"
                value={formData.timeOfBirth}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Place of Birth */}
          <div className="form-group">
            <label htmlFor="placeOfBirth">Place of Birth</label>
            <input
              id="placeOfBirth"
              name="placeOfBirth"
              type="text"
              placeholder="e.g. Mumbai, India"
              value={formData.placeOfBirth}
              onChange={handleChange}
            />
          </div>

          {/* Actions */}
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onClose(null)}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? (
                <>
                  <span className="spinner-sm" />
                  Saving…
                </>
              ) : (
                <>✦ Save Profile</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
